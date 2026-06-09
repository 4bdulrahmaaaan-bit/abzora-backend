const crypto = require('crypto');
const mongoose = require('mongoose');

const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');
const Product = require('../models/Product');
const RefundRequest = require('../models/RefundRequest');
const Transaction = require('../models/Transaction');
const PaymentOutboxEvent = require('../models/PaymentOutboxEvent');
const { enqueueInvoiceJob } = require('../services/invoiceService');
const PaymentWebhookIngestEvent = require('../models/PaymentWebhookIngestEvent');
const { recordFinanceAudit, reverseOrderSettlement } = require('../services/financeService');
const {
  createRazorpayOrder,
  verifyPayment,
} = require('./orderController');
const { claimWebhookDelivery } = require('../services/webhookLockService');
const { persistWebhookIngestEvent } = require('../services/paymentWebhookIngestService');
const telemetry = require('../services/telemetryContext');
const otel = require('../services/otelService');

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

async function deductInventoryAtomically(items, session) {
  // Security hardening: atomic stock reservation with stock floor checks.
  // Prevents concurrent payment captures from driving inventory negative.
  // Security/performance hardening: stable lock acquisition order reduces contention.
  const orderedItems = [...(items || [])].sort((left, right) =>
    String(left?.productId || '').localeCompare(String(right?.productId || ''))
  );
  for (const item of orderedItems) {
    const quantity = Number(item?.quantity || 0);
    const productId = item?.productId;
    if (!productId || quantity <= 0) {
      continue;
    }
    const result = await Product.updateOne(
      { _id: productId, stock: { $gte: quantity } },
      { $inc: { stock: -quantity } },
      { session },
    );
    if (!result || result.modifiedCount !== 1) {
      const stockError = new Error('Insufficient stock for one or more products.');
      stockError.statusCode = 409;
      throw stockError;
    }
  }
}

function buildOutboxEventId(prefix, orderId) {
  return `${prefix}:${orderId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
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
  const span = otel.startSpan('payment.captured.process', {
    'abianzo.flow': 'payment',
    'abianzo.event': 'payment.captured',
  });
  const startedAt = Date.now();
  try {
  const razorpayOrderId = paymentEntity?.order_id?.toString() || '';
  const razorpayPaymentId = paymentEntity?.id?.toString() || '';
  const appOrderId = paymentEntity?.notes?.appOrderId?.toString() || '';

  let order = null;
  let isTrial = false;
  const flow = paymentEntity?.notes?.flow || '';
  if (flow === 'tbyb_checkout') {
    isTrial = true;
    if (mongoose.Types.ObjectId.isValid(appOrderId)) {
      order = await TrialHomeSession.findById(appOrderId);
    }
    if (!order && razorpayOrderId) {
      order = await TrialHomeSession.findOne({ razorpayOrderId });
    }
  } else {
    if (mongoose.Types.ObjectId.isValid(appOrderId)) {
      order = await Order.findById(appOrderId);
    }
    if (!order && razorpayOrderId) {
      order = await Order.findOne({ 'razorpay.orderId': razorpayOrderId });
    }
  }

  if (!order) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_unmatched',
      status: 'failed',
      message: 'Captured payment webhook could not be matched to an order or trial session.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
        appOrderId,
        flow,
      },
    });
    return null;
  }

  // Critical Fix 3: Strict Idempotency Check
  if (isTrial && order.paymentStatus === 'captured') {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_duplicate',
      order,
      amount: Number(order.finalAmount || 0),
      message: 'Duplicate captured payment webhook ignored for TBYB.',
      metadata: { razorpayOrderId, razorpayPaymentId, flow },
    });
    return order;
  }

  if (!isTrial && (order.paymentStatus || '').toLowerCase() === 'paid') {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_duplicate',
      order,
      amount: Number(order.totalAmount || 0),
      message: 'Duplicate captured payment webhook ignored for Order.',
      metadata: { razorpayOrderId, razorpayPaymentId, flow },
    });
    return order;
  }
  if (isTrial) {
    order.razorpayPaymentId = razorpayPaymentId;
    order.paymentStatus = 'captured';
    order.paymentCollected = true;
    order.paymentMethod = 'Online';
    order.paymentCollectedAt = new Date();
    
    // Auto-complete the trial if rider had submitted checkout and outcome already
    if (order.status === 'trial_active' || order.status === 'trial_in_progress' || order.status === 'trial_started') {
      // In this setup, since we blocked Rider from completing the trial if online payment isn't captured,
      // the webhook is responsible for completing it if the rider already submitted data.
      // Wait, the rider calls /complete, it gets blocked. The webhook marks it captured. 
      // Then the rider polls or just lets the UI fetch again, and then they can call /complete, 
      // OR the webhook can transition status. 
      // Safest approach: just update paymentStatus to 'captured', and let the rider call /complete again, which will now pass the check!
    }

    await order.save();
    
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_trial',
      order,
      amount: Number(order.finalAmount || 0),
      message: 'Payment captured for TBYB Trial.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
        flow,
      },
    });
    return order;
  }

  const paymentCurrency = String(paymentEntity?.currency || '').trim().toUpperCase();
  const capturedAmountPaise = Number(paymentEntity?.amount || 0);
  const expectedAmountPaise = Math.round(Number(order.totalAmount || 0) * 100);
  const capturedAppOrderId = String(paymentEntity?.notes?.appOrderId || '').trim();

  // Security hardening: webhook capture must match expected amount/currency/app order.
  // If these checks fail, we do not mark the order paid.
  if (
    paymentCurrency !== 'INR' ||
    !Number.isFinite(capturedAmountPaise) ||
    capturedAmountPaise !== expectedAmountPaise ||
    (capturedAppOrderId && capturedAppOrderId !== order._id.toString())
  ) {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_captured_validation_failed',
      status: 'failed',
      order,
      amount: Number(order.totalAmount || 0),
      message: 'Captured payment failed strict amount/currency/order validation.',
      metadata: {
        razorpayOrderId,
        razorpayPaymentId,
        paymentCurrency,
        capturedAmountPaise: String(capturedAmountPaise),
        expectedAmountPaise: String(expectedAmountPaise),
        capturedAppOrderId,
      },
    });
    return null;
  }

  let outboxEventId = '';
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      span.addEvent('mongo.transaction.started');
      // Security hardening: webhook capture state and stock mutation are atomic.
      const txOrder = await Order.findById(order._id).session(session);
      if (!txOrder) {
        const missing = new Error('Order not found.');
        missing.statusCode = 404;
        throw missing;
      }
      txOrder.razorpay = {
        ...txOrder.razorpay,
        orderId: razorpayOrderId || txOrder.razorpay?.orderId || '',
        paymentId: razorpayPaymentId || txOrder.razorpay?.paymentId || '',
      };
      txOrder.paymentStatus = 'paid';
      txOrder.escrowStatus = 'held';
      txOrder.escrowUpdatedAt = nowIso();
      if ((txOrder.orderStatus || '').toLowerCase() === 'pending') {
        txOrder.orderStatus = 'confirmed';
      }
      if ((txOrder.deliveryStatus || '').toLowerCase() === 'pending') {
        txOrder.deliveryStatus = 'Ready for pickup';
      }
      appendTrackingTimestamp(txOrder, 'Confirmed');

      if (!txOrder.inventoryDeducted) {
        await deductInventoryAtomically(txOrder.items || [], session);
        txOrder.inventoryDeducted = true;
      }
      txOrder.financialReversed = false;
      await txOrder.save({ session });
      // Security hardening: outbox event is written in the same transaction
      // to preserve post-commit side-effect intent durably.
      outboxEventId = buildOutboxEventId('payment_captured_webhook', txOrder._id.toString());
      await PaymentOutboxEvent.create(
        [{
          eventId: outboxEventId,
          eventType: 'payment_captured_webhook',
          orderId: txOrder._id.toString(),
          payload: {
            razorpayOrderId,
            razorpayPaymentId,
          },
          metadata: {
            traceId: telemetry.getContext().traceId || '',
            spanId: telemetry.getContext().spanId || '',
            requestId: telemetry.getContext().requestId || '',
          },
        }],
        { session },
      );
      span.addEvent('mongo.transaction.committed_intent');
      order = txOrder;
    });
  } finally {
    await session.endSession();
  }
  try {
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
    if (outboxEventId) {
      await PaymentOutboxEvent.updateOne(
        { eventId: outboxEventId },
        { $set: { status: 'processed', processedAtIso: nowIso(), lastError: '' } },
      );
    }
  } catch (sideEffectError) {
    // Security hardening: preserve successful order/payment commit even if
    // downstream observability writes fail; mark outbox for replay.
    if (outboxEventId) {
      await PaymentOutboxEvent.updateOne(
        { eventId: outboxEventId },
        { $set: { status: 'failed', processedAtIso: nowIso(), lastError: String(sideEffectError?.message || sideEffectError) } },
      );
    }
  }
  await enqueueInvoiceJob(order._id.toString(), 'payment_webhook_captured');
  return order;
  } finally {
    span.setAttribute('abianzo.latency_ms', Date.now() - startedAt);
    span.end();
  }
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
  const span = otel.startSpan('webhook.razorpay.verify_and_enqueue', {
    'abianzo.flow': 'webhook',
  });
  const startedAt = Date.now();
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
    span.setAttribute('abianzo.webhook_event', String(payload?.event || 'unknown'));
    const eventId = payload?.payload?.payment?.entity?.id
      || payload?.payload?.refund?.entity?.id
      || payload?.created_at
      || '';
    const deliveryLock = await claimWebhookDelivery({
      source: 'razorpay-payment',
      rawBody,
      eventId,
      signature,
    });
    if (deliveryLock?.status === 'duplicate') {
      return res.status(200).json({ success: true, duplicate: true });
    }
    if (deliveryLock?.status === 'lock_error') {
      // Security hardening: return retriable error when idempotency lock storage is unavailable.
      // This avoids silently dropping valid webhook events.
      return res.status(503).json({ success: false, message: 'Webhook lock unavailable. Retry later.' });
    }
    const event = String(payload?.event || '').trim();
    const eventValidation = validateWebhookSchema(event, payload);
    if (!eventValidation.valid) {
      await recordPaymentWebhookAudit({
        action: 'payment_webhook_schema_invalid',
        status: 'failed',
        message: 'Invalid webhook payload schema.',
        metadata: { event, reason: eventValidation.reason },
      });
      return res.status(400).json({ success: false, message: 'Invalid webhook payload schema.' });
    }

    // Security hardening: persist minimal durable ingest event and ACK quickly.
    // Heavy payment/order/inventory mutations happen asynchronously in worker.
    const ingest = await persistWebhookIngestEvent({
      source: 'razorpay-payment',
      event,
      eventId: String(eventId || ''),
      rawBody,
      payload: buildMinimalIngestPayload(payload),
      metadata: {
        lockKey: deliveryLock?.key || '',
      },
    });
    if (ingest.duplicate) {
      return res.status(200).json({ success: true, duplicate: true, event });
    }
    return res.status(202).json({ success: true, accepted: true, event });
  } catch (error) {
    if (error?.name === 'MongoNetworkError' || error?.name === 'MongooseError') {
      return res.status(503).json({ success: false, message: 'Webhook ingest unavailable. Retry later.' });
    }
    return next(error);
  } finally {
    span.setAttribute('abianzo.latency_ms', Date.now() - startedAt);
    span.end();
  }
}

function buildMinimalIngestPayload(payload) {
  const event = String(payload?.event || '').trim();
  return {
    event,
    created_at: Number(payload?.created_at || 0),
    payment: payload?.payload?.payment?.entity || null,
    refund: payload?.payload?.refund?.entity || null,
  };
}

function validateWebhookSchema(event, payload) {
  const supported = new Set(['payment.captured', 'payment.failed', 'refund.processed']);
  if (!supported.has(event)) {
    return { valid: false, reason: 'unsupported_event' };
  }
  if (event === 'refund.processed') {
    const refund = payload?.payload?.refund?.entity;
    if (!refund?.id || !refund?.payment_id) {
      return { valid: false, reason: 'missing_refund_entity' };
    }
    return { valid: true };
  }
  const payment = payload?.payload?.payment?.entity;
  if (!payment?.id || !payment?.order_id) {
    return { valid: false, reason: 'missing_payment_entity' };
  }
  return { valid: true };
}

async function processPaymentWebhookIngestEvent(eventDoc) {
  const span = otel.startSpan('webhook.ingest.process', {
    'abianzo.flow': 'webhook_ingest',
    'abianzo.event': String(eventDoc?.event || 'unknown'),
  });
  const ingestId = String(eventDoc?.ingestId || '');
  const event = String(eventDoc?.event || '');
  const payload = eventDoc?.payload || {};

  // Replay-safe: skip if this ingest item already marked processed elsewhere.
  const existing = await PaymentWebhookIngestEvent.findOne({ ingestId }).select('status').lean();
  if (existing && existing.status === 'processed') {
    span.addEvent('duplicate_skip');
    span.end();
    return { skippedDuplicate: true };
  }

  if (event === 'payment.captured') {
    await handlePaymentCaptured(payload?.payment || {});
  } else if (event === 'payment.failed') {
    await handlePaymentFailed(payload?.payment || {});
  } else if (event === 'refund.processed') {
    await handleRefundProcessed(payload?.refund || {});
  } else {
    await recordPaymentWebhookAudit({
      action: 'payment_webhook_ignored',
      message: `Ignored unsupported Razorpay payment webhook event: ${event || 'unknown'}.`,
      metadata: { event, ingestId },
    });
  }
  span.end();
  return { processed: true };
}

module.exports = {
  createPaymentOrder,
  processPaymentWebhookIngestEvent,
  verifyPaymentSignature,
  handleRazorpayWebhook,
};


