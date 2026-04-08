const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createPaymentOrder,
  verifyPaymentSignature,
} = require('../controllers/paymentController');

const router = express.Router();

router.use(authMiddleware);
router.post('/create-order', createPaymentOrder);
router.post('/verify', verifyPaymentSignature);

module.exports = router;
