const express = require('express');

const { handleRazorpayPayoutWebhook } = require('../controllers/financeController');
const { handleRazorpayWebhook } = require('../controllers/paymentController');

const router = express.Router();

router.post('/razorpayx', handleRazorpayPayoutWebhook);
router.post('/razorpay', handleRazorpayWebhook);

module.exports = router;
