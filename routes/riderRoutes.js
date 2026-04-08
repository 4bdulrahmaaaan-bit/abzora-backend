const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getRiderPayoutProfile,
  getRiderWallet,
  requestRiderWithdraw,
  saveRiderPayoutProfile,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/wallet', getRiderWallet);
router.post('/withdraw', requestRiderWithdraw);
router.get('/payout-account', getRiderPayoutProfile);
router.post('/payout-account', saveRiderPayoutProfile);

module.exports = router;
