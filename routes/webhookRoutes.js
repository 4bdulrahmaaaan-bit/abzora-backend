const express = require('express');
const crypto = require('crypto');
const { queueWebhookEvent } = require('../services/webhookQueueService');
const { handleRazorpayPayoutWebhook } = require('../controllers/financeController');
const Order = require('../models/Order');

const router = express.Router();

function verifyRazorpayWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET_KEY;
  if (!secret || !signature || !rawBody) {
    return false;
  }
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(String(signature), 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

function verifyCourierWebhookToken(token) {
  const secret = process.env.COURIER_WEBHOOK_TOKEN || '';
  if (!secret) {
    return true;
  }
  return String(token || '').trim() === secret.trim();
}

function normalizeCourierStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (['created', 'ready_to_ship', 'ready to ship'].includes(value)) return 'Ready to ship';
  if (['pickup_requested', 'pickup requested', 'pickup_scheduled', 'pickup scheduled'].includes(value)) return 'Pickup scheduled';
  if (['picked_up', 'picked up'].includes(value)) return 'Picked up';
  if (['in_transit', 'in transit'].includes(value)) return 'In transit';
  if (['out_for_delivery', 'out for delivery'].includes(value)) return 'Out for delivery';
  if (['delivered'].includes(value)) return 'Delivered';
  if (['failed', 'cancelled', 'canceled'].includes(value)) return 'Cancelled';
  return '';
}

function trackingKeyForDeliveryStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'ready for pickup':
      return 'Confirmed';
    case 'assigned':
    case 'picked up':
      return 'Packed';
    case 'out for delivery':
      return 'Out for delivery';
    case 'delivered':
      return 'Delivered';
    case 'cancelled':
      return 'Cancelled';
    case 'pickup scheduled':
      return 'Assigned';
    case 'in transit':
      return 'Out for delivery';
    default:
      return '';
  }
}

function trackingKeyForOrderStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'created':
      return 'Order Placed';
    case 'confirmed':
      return 'Order Confirmed';
    case 'processing':
      return 'Order Processing';
    case 'shipped':
      return 'Order Shipped';
    case 'delivered':
      return 'Order Delivered';
    case 'cancelled':
      return 'Order Cancelled';
    default:
      return '';
  }
}

function appendTrackingTimestamp(order, key) {
  if (!key) {
    return;
  }
  const timestamps = { ...(order.trackingTimestamps || {}) };
  if (!timestamps[key]) {
    timestamps[key] = new Date().toISOString();
  }
  order.trackingTimestamps = timestamps;
}

async function applyCourierWebhook(orderId, payload = {}) {
  if (!orderId) {
    return { success: false, message: 'orderId required' };
  }
  const order = await Order.findById(orderId);
  if (!order) {
    return { success: false, message: 'Order not found' };
  }
  const normalizedStatus = normalizeCourierStatus(payload.status || payload.deliveryStatus || payload.shipmentStatus);
  if (normalizedStatus) {
    order.deliveryStatus = normalizedStatus;
    if (normalizedStatus === 'Ready to ship') order.orderStatus = 'confirmed';
    if (normalizedStatus === 'Pickup scheduled') order.orderStatus = 'processing';
    if (normalizedStatus === 'Picked up' || normalizedStatus === 'In transit' || normalizedStatus === 'Out for delivery') order.orderStatus = 'shipped';
    if (normalizedStatus === 'Delivered') {
      order.orderStatus = 'delivered';
      order.paymentStatus = order.paymentMethod === 'COD' ? 'paid' : order.paymentStatus;
    }
    if (normalizedStatus === 'Cancelled') {
      order.orderStatus = 'cancelled';
    }
  }
  if (payload.trackingNumber) order.trackingNumber = String(payload.trackingNumber).trim();
  if (payload.shipmentId) order.shipmentId = String(payload.shipmentId).trim();
  if (payload.awbNumber) order.awbNumber = String(payload.awbNumber).trim();
  if (payload.deliveryProvider) order.deliveryProvider = String(payload.deliveryProvider).trim();
  if (payload.deliveryPartner) order.assignedDeliveryPartner = String(payload.deliveryPartner).trim();
  if (payload.shippingCharge != null) order.shippingCharge = Number(payload.shippingCharge || 0);
  appendTrackingTimestamp(order, trackingKeyForDeliveryStatus(order.deliveryStatus));
  appendTrackingTimestamp(order, trackingKeyForOrderStatus(order.orderStatus));
  await order.save();
  return { success: true, data: order.toObject() };
}

// Use raw body for accurate signature verification
router.use(express.raw({ type: 'application/json' }));

router.post('/razorpayx', handleRazorpayPayoutWebhook);

router.post('/razorpay', async (req, res, next) => {
  try {
    const signature = req.headers['x-razorpay-signature'] || '';
    const rawBody = req.body;
    
    if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = String(payload?.event || '').trim();
    
    if (event === 'payment.captured' || event === 'payment.failed') {
      await queueWebhookEvent(event, payload, rawBody, signature);
    }
    
    return res.status(202).json({ success: true, accepted: true, event });
  } catch (error) {
    next(error);
  }
});

router.post('/courier', async (req, res, next) => {
  try {
    if (!verifyCourierWebhookToken(req.headers['x-courier-webhook-token'])) {
      return res.status(401).json({ success: false, message: 'Invalid courier webhook token.' });
    }
    const body = req.body;
    const payload = body && typeof body === 'object' && !Buffer.isBuffer(body)
      ? body
      : JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : '{}');
    const orderId = payload.orderId || payload.order_id || payload.id;
    const result = await applyCourierWebhook(orderId, payload);
    if (!result.success) {
      return res.status(404).json(result);
    }
    return res.status(202).json({ success: true, accepted: true, data: result.data });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
