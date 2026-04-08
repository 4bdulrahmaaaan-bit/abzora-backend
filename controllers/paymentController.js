const crypto = require('crypto');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const { reverseOrderSettlement } = require('../services/financeService');
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
    return null;
  }
  if (
    (order.paymentStatus || '').toLowerCase() === 'paid' &&
    String(order.razorpay?.paymentId || '') === razorpayPaymentId
  ) {
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
  return order;
}

async function handlePaymentFailed(paymentEntity) {
  const razorpayOrderId = paymentEntity?.order_id?.toString() || '';
  const razorpayPaymentId = paymentEntity?.id?.toString() || '';
  const order = await Order.findOne({ 'razorpay.orderId': razorpayOrderId });
  if (!order) {
    return null;
  }
  if (
    (order.paymentStatus || '').toLowerCase() === 'failed' &&
    String(order.razorpay?.paymentId || '') === razorpayPaymentId
  ) {
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
  return order;
}

async function handleRefundProcessed(refundEntity) {
  const paymentId = refundEntity?.payment_id?.toString() || '';
  const amountPaise = Number(refundEntity?.amount || 0);
  const amount = amountPaise > 0 ? amountPaise / 100 : 0;
  const order = await Order.findOne({ 'razorpay.paymentId': paymentId });
  if (!order) {
    return null;
  }
  if ((order.escrowStatus || '').toLowerCase() === 'refunded' && order.financialReversed) {
    return order;
  }

  order.paymentStatus = 'refunded';
  order.refundStatus = 'refunded';
  order.escrowStatus = 'refunded';
  order.escrowUpdatedAt = nowIso();
  appendTrackingTimestamp(order, 'Cancelled');
  await reverseOrderSettlement(order, 'Refund processed via Razorpay webhook');
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
      razorpayRefundId: String(refundEntity?.id || ''),
      razorpayPaymentId: paymentId,
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
