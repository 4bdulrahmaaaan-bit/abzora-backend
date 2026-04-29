const crypto = require('crypto');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Product = require('../models/Product');
const RefundRequest = require('../models/RefundRequest');
const Transaction = require('../models/Transaction');
const { recordFinanceAudit, reverseOrderSettlement } = require('../services/financeService');
const {
  createRazorpayOrder,
  verifyPayment,
} = require('./orderController');

function nowIso() {
  return new Date().toISOString();
}

function buildTransactionId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function razorpayWebhookSecret() {
  return process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_SECRET || '';
}

function verifyRazorpayWebhookSignature(rawBody, signature) {
  const secret = razorpayWebhookSecret();
  if (!secret || !signature || !rawBody) {
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(String(signature || ''), 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function appendTrackingTimestamp(order, key) {
  if (!key) {
    return;
  }
  const timestamps = { ...(order.trackingTimestamps || {}) };
  if (!timestamps[key]) {
    timestamps[key] = nowIso();
  }
  order.trackingTimestamps = timestamps;
}

async function recordPaymentTransaction({
  order,
  status,
  note,
  metadata = {},
}) {
  await Transaction.create({
    transactionId: buildTransactionId('payment'),
    type: 'payment',
    userType: 'admin',
    userId: order.userId || 'unknown',
    storeId: order.storeId?.toString() || '',
    orderId: order._id.toString(),
    amount: Number(order.totalAmount || 0),
    status,
    note,
    createdAtIso: nowIso(),
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]),
    ),
  });
}

async function recordPaymentWebhookAudit({
  action,
  status = 'success',
  order = null,
  amount = 0,
  message = '',
  metadata = {},
}) {
  await recordFinanceAudit({
    action,
    actorId: 'razorpay-webhook',
    actorRole: 'system',
    status,
    walletType: 'admin',
    storeId: order?.storeId?.toString?.() || '',
    orderIds: order?._id ? [order._id.toString()] : [],
    amount,
    message,
    metadata,
  });
}

async function handlePaymentCaptured(paymentEntity) {
  const razorpayOrderId = paymentEntity?.order_id?.toString() || '';
  const razorpayPaymentId = paymentEntity?.id?.toString() || '';
  const appOrderId = paymentEntity?.notes?.appOrderId?.toString() || '';

  let order = null;
  if (mongoose.Types.ObjectId.isValid(appOrderId)) {
    order = await Order.findById(appOrderId);
  }
  if (!order && razorpayOrderId) {
    order = await Order.findOne({ 'razorpay.orderId': razorpayOrderId });
  }
  if (!order) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_unmatched',
      status: 'failed',
      message: 'Captured payment webhook could not be matched to an order.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
        appOrderId,
      },
    });
    return null;
  }
  if (
    (order.paymentStatus || '').toLowerCase() === 'paid' &&
    String(order.razorpay?.paymentId || '') === razorpayPaymentId
  ) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_duplicate',
      order,
      amount: Number(order.totalAmount || 0),
      message: 'Duplicate captured payment webhook ignored.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
      },
    });
    return order;
  }

  order.razorpay = {
    ...order.razorpay,
    orderId: razorpayOrderId || order.razorpay?.orderId || '',
    paymentId: razorpayPaymentId || order.razorpay?.paymentId || '',
  };
  order.paymentStatus = 'paid';
  order.escrowStatus = 'held';
  order.escrowUpdatedAt = nowIso();
  if ((order.orderStatus || '').toLowerCase() === 'pending') {
    order.orderStatus = 'confirmed';
  }
  if ((order.deliveryStatus || '').toLowerCase() === 'pending') {
    order.deliveryStatus = 'Ready for pickup';
  }
  appendTrackingTimestamp(order, 'Confirmed');

  if (!order.inventoryDeducted) {
    for (const item of order.items || []) {
      await Product.findByIdAndUpdate(item.productId, { $inc: { stock: -Number(item.quantity || 0) } });
    }
    order.inventoryDeducted = true;
  }
  order.financialReversed = false;
  await order.save();
  await recordPaymentTransaction({
    order,
    status: 'captured',
    note: 'Payment captured via Razorpay webhook.',
    metadata: {
      razorpayOrderId,
      razorpayPaymentId,
    },
  });
  await recordPaymentWebhookAudit({
    action: 'payment_webhook_captured',
    order,
    amount: Number(order.totalAmount || 0),
    message: 'Payment captured via Razorpay webhook.',
    metadata: {
      razorpayOrderId,
      razorpayPaymentId,
    },
  });
  return order;
}

async function handlePaymentFailed(paymentEntity) {
  const razorpayOrderId = paymentEntity?.order_id?.toString() || '';
  const razorpayPaymentId = paymentEntity?.id?.toString() || '';
  const order = await Order.findOne({ 'razorpay.orderId': razorpayOrderId });
  if (!order) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_failed_unmatched',
      status: 'failed',
      message: 'Failed payment webhook could not be matched to an order.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
      },
    });
    return null;
  }
  const normalizedPaymentStatus = String(order.paymentStatus || '').toLowerCase();
  if (
    normalizedPaymentStatus === 'paid' ||
    normalizedPaymentStatus === 'captured' ||
    normalizedPaymentStatus === 'refunded'
  ) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_failed_ignored',
      order,
      amount: Number(order.totalAmount || 0),
      message: 'Late or duplicate failed payment webhook ignored for paid/refunded order.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
        currentPaymentStatus: normalizedPaymentStatus,
      },
    });
    return order;
  }
  if (
    normalizedPaymentStatus === 'failed' &&
    String(order.razorpay?.paymentId || '') === razorpayPaymentId
  ) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_failed_duplicate',
      order,
      amount: Number(order.totalAmount || 0),
      message: 'Duplicate failed payment webhook ignored.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
      },
    });
    return order;
  }
  order.paymentStatus = 'failed';
  order.razorpay = {
    ...order.razorpay,
    orderId: razorpayOrderId || order.razorpay?.orderId || '',
    paymentId: razorpayPaymentId || order.razorpay?.paymentId || '',
  };
  await order.save();
  await recordPaymentTransaction({
    order,
    status: 'failed',
    note: 'Payment failed via Razorpay webhook.',
    metadata: {
      razorpayOrderId,
      razorpayPaymentId,
    },
  });
  await recordPaymentWebhookAudit({
    action: 'payment_webhook_failed',
    order,
    amount: Number(order.totalAmount || 0),
    message: 'Payment failed via Razorpay webhook.',
    metadata: {
      razorpayOrderId,
      razorpayPaymentId,
    },
  });
  return order;
}

async function handleRefundProcessed(refundEntity) {
  const paymentId = refundEntity?.payment_id?.toString() || '';
  const refundId = String(refundEntity?.id || '').trim();
  const amountPaise = Number(refundEntity?.amount || 0);
  const amount = amountPaise > 0 ? amountPaise / 100 : 0;
  const order = await Order.findOne({ 'razorpay.paymentId': paymentId });
  if (!order) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_refund_unmatched',
      status: 'failed',
      amount,
      message: 'Refund webhook could not be matched to an order.',
      metadata: {
        razorpayPaymentId: paymentId,
        razorpayRefundId: String(refundEntity?.id || ''),
      },
    });
    return null;
  }
  if ((order.escrowStatus || '').toLowerCase() === 'refunded' && order.financialReversed) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_refund_duplicate',
      order,
      amount,
      message: 'Duplicate refund webhook ignored for already reversed order.',
      metadata: {
        razorpayPaymentId: paymentId,
        razorpayRefundId: String(refundEntity?.id || ''),
      },
    });
    return order;
  }

  if (refundId) {
    const existingRefundTx = await Transaction.findOne({
      type: 'refund',
      'metadata.razorpayRefundId': refundId,
      orderId: order._id.toString(),
    });
    if (existingRefundTx) {
      await recordPaymentWebhookAudit({
        action: 'payment_webhook_refund_duplicate_tx',
        order,
        amount,
        message: 'Duplicate refund webhook ignored because refund transaction already exists.',
        metadata: {
          razorpayPaymentId: paymentId,
          razorpayRefundId: refundId,
        },
      });
      return order;
    }
  }

  const refundRequestId = String(refundEntity?.notes?.refundRequestId || '').trim();
  let refundRequest = null;
  if (mongoose.Types.ObjectId.isValid(refundRequestId)) {
    refundRequest = await RefundRequest.findById(refundRequestId);
  }
  if (!refundRequest && refundId) {
    refundRequest = await RefundRequest.findOne({ gatewayRefundId: refundId });
  }
  if (refundRequest) {
    refundRequest.gatewayRefundId = refundId || String(refundRequest.gatewayRefundId || '');
    refundRequest.refundedAmount = Math.max(
      Number(refundRequest.refundedAmount || 0),
      amount,
    );
    if (refundRequest.status === 'pending') {
      refundRequest.status = 'approved';
    }
    await refundRequest.save();
    order.refundRequestId = refundRequest._id.toString();
  }

  const fullRefund = amount >= Math.max(0, Number(order.totalAmount || 0)) - 0.01;
  order.refundStatus = fullRefund ? 'refunded' : 'approved';
  if (fullRefund) {
    order.paymentStatus = 'refunded';
    order.escrowStatus = 'refunded';
    order.escrowUpdatedAt = nowIso();
    appendTrackingTimestamp(order, 'Cancelled');
    await reverseOrderSettlement(order, 'Refund processed via Razorpay webhook');
  }
  await order.save();

  await Transaction.create({
    transactionId: buildTransactionId('refund'),
    type: 'refund',
    userType: 'admin',
    userId: order.userId || 'unknown',
    storeId: order.storeId?.toString() || '',
    orderId: order._id.toString(),
    amount: -Math.abs(amount || Number(order.totalAmount || 0)),
    status: 'processed',
      note: 'Refund processed via Razorpay webhook.',
      createdAtIso: nowIso(),
      metadata: {
      razorpayRefundId: refundId,
        razorpayPaymentId: paymentId,
      },
  });
  await recordPaymentWebhookAudit({
    action: 'payment_webhook_refund_processed',
    order,
    amount,
    message: fullRefund
      ? 'Full refund processed via Razorpay webhook.'
      : 'Partial refund processed via Razorpay webhook.',
    metadata: {
      razorpayPaymentId: paymentId,
      razorpayRefundId: refundId,
      fullRefund: String(fullRefund),
    },
  });
  return order;
}

async function createPaymentOrder(req, res, next) {
  return createRazorpayOrder(req, res, next);
}

async function verifyPaymentSignature(req, res, next) {
  return verifyPayment(req, res, next);
}

async function handleRazorpayWebhook(req, res, next) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      await recordPaymentWebhookAudit({
        action: 'payment_webhook_invalid_signature',
        status: 'failed',
        message: 'Invalid Razorpay payment webhook signature.',
        metadata: {
          event: String(req.body?.event || ''),
        },
      });
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = String(payload?.event || '').trim();

    if (event === 'payment.captured') {
      await handlePaymentCaptured(payload?.payload?.payment?.entity || {});
      return res.status(200).json({ success: true, event });
    }
    if (event === 'payment.failed') {
      await handlePaymentFailed(payload?.payload?.payment?.entity || {});
      return res.status(200).json({ success: true, event });
    }
    if (event === 'refund.processed') {
      await handleRefundProcessed(payload?.payload?.refund?.entity || {});
      return res.status(200).json({ success: true, event });
    }
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_ignored',
      message: `Ignored unsupported Razorpay payment webhook event: ${event || 'unknown'}.`,
      metadata: {
        event,
      },
    });
    return res.status(200).json({ success: true, ignored: true, event });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createPaymentOrder,
  verifyPaymentSignature,
  handleRazorpayWebhook,
};
