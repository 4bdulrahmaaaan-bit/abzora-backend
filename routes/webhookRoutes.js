const express = require('express');
const crypto = require('crypto');
const { queueWebhookEvent } = require('../services/webhookQueueService');
const { handleRazorpayPayoutWebhook } = require('../controllers/financeController');

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

module.exports = router;
