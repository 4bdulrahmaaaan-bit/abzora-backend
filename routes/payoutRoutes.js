const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  settleVendorPayouts,
  settleRiderPayouts,
  approvePendingWithdrawal,
  rejectPendingWithdrawal,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.post('/vendor/settle', settleVendorPayouts);
router.post('/rider/settle', settleRiderPayouts);
router.post('/withdrawals/:requestId/approve', approvePendingWithdrawal);
router.post('/withdrawals/:requestId/reject', rejectPendingWithdrawal);

module.exports = router;

