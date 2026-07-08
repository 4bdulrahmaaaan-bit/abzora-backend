const crypto = require('crypto');
const Order = require('../models/Order');
const { getShiprocketConfig, isShiprocketEnabled } = require('../services/deliveryModeService');

function verifyWebhookSignature(payload, signature, secret) {
  if (!secret) return true; // Bypass if no secret configured
  const hmac = crypto.createHmac('sha256', secret);
  const hash = hmac.update(JSON.stringify(payload)).digest('hex');
  return hash === signature;
}

const statusMap = {
  6: 'In transit',
  7: 'Delivered',
  8: 'Cancelled',
  9: 'Return in transit',
  18: 'Out for delivery',
  20: 'In transit' // In Transit
};

async function handleStatusUpdate(req, res) {
  if (!isShiprocketEnabled()) {
    return res.status(403).json({ success: false, message: 'Shiprocket integration disabled' });
  }

  const signature = req.headers['x-shiprocket-signature'] || '';
  const config = getShiprocketConfig();
  
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : JSON.stringify(req.body);
  const payload = typeof req.body === 'object' && !Buffer.isBuffer(req.body) 
    ? req.body 
    : JSON.parse(rawBody || '{}');

  if (config.webhookSecret && !verifyWebhookSignature(payload, signature, config.webhookSecret)) {
    return res.status(401).json({ success: false, message: 'Invalid signature' });
  }

  const { order_id, current_status_id, current_status, awb, shipment_id } = payload;

  
  if (!order_id) {
    return res.status(400).json({ success: false, message: 'Missing order_id' });
  }

  try {
    const order = await Order.findById(order_id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const internalStatus = statusMap[current_status_id] || current_status;
    
    // Only update if it's a known mapped status, or just keep current
    if (statusMap[current_status_id]) {
      order.deliveryStatus = internalStatus;
      
      if (internalStatus === 'Delivered') {
        order.orderStatus = 'delivered';
      } else if (internalStatus === 'Cancelled') {
        order.orderStatus = 'cancelled';
      }

      order.trackingTimestamps = order.trackingTimestamps || {};
      order.trackingTimestamps[internalStatus.replace(/\s+/g, '_').toLowerCase()] = new Date();
    }
    
    if (awb && !order.awbNumber) order.awbNumber = String(awb);
    if (shipment_id && !order.shipmentId) order.shipmentId = String(shipment_id);

    await order.save();

    return res.status(200).json({ success: true, message: 'Webhook processed' });
  } catch (error) {
    console.error('Shiprocket webhook error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = {
  handleStatusUpdate
};
