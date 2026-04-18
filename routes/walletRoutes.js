const express = require('express');

const { requireRider, requireVendor } = require('../middleware/authorizationMiddleware');
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

router.get('/', getUserWalletSummary);
router.get('/vendor', requireVendor, getVendorWallet);
router.post('/vendor/withdraw', requireVendor, requestVendorWithdraw);
router.get('/vendor/payout-account', requireVendor, getVendorPayoutProfile);
router.post('/vendor/payout-account', requireVendor, saveVendorPayoutProfile);

router.get('/rider', requireRider, getRiderWallet);
router.post('/rider/withdraw', requireRider, requestRiderWithdraw);
router.get('/rider/payout-account', requireRider, getRiderPayoutProfile);
router.post('/rider/payout-account', requireRider, saveRiderPayoutProfile);

module.exports = router;
