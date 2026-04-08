const express = require('express');

const { handleRazorpayPayoutWebhook } = require('../controllers/financeController');

const router = express.Router();

router.post('/razorpayx', handleRazorpayPayoutWebhook);

module.exports = router;
