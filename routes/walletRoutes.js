const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getUserWalletSummary,
  getVendorWallet,
  requestVendorWithdraw,
  getVendorPayoutProfile,
  saveVendorPayoutProfile,
  getRiderWallet,
  requestRiderWithdraw,
  getRiderPayoutProfile,
  saveRiderPayoutProfile,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/', getUserWalletSummary);
router.get('/vendor', getVendorWallet);
router.post('/vendor/withdraw', requestVendorWithdraw);
router.get('/vendor/payout-account', getVendorPayoutProfile);
router.post('/vendor/payout-account', saveVendorPayoutProfile);

router.get('/rider', getRiderWallet);
router.post('/rider/withdraw', requestRiderWithdraw);
router.get('/rider/payout-account', getRiderPayoutProfile);
router.post('/rider/payout-account', saveRiderPayoutProfile);

module.exports = router;
