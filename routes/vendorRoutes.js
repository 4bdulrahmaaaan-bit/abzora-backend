const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getVendorPayoutProfile,
  getVendorWallet,
  requestVendorWithdraw,
  saveVendorPayoutProfile,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/wallet', getVendorWallet);
router.post('/withdraw', requestVendorWithdraw);
router.get('/payout-account', getVendorPayoutProfile);
router.post('/payout-account', saveVendorPayoutProfile);

module.exports = router;
