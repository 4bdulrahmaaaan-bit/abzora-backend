const express = require('express');

const { validateBody } = require('../validation/schemaValidator');
const {
  payoutProfileSchema,
  withdrawalRequestSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
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
router.post('/vendor/withdraw', requireVendor, validateBody(withdrawalRequestSchema), requestVendorWithdraw);
router.get('/vendor/payout-account', requireVendor, getVendorPayoutProfile);
router.post('/vendor/payout-account', validateBody(payoutProfileSchema), saveVendorPayoutProfile);

router.get('/rider', requireRider, getRiderWallet);
router.post('/rider/withdraw', requireRider, validateBody(withdrawalRequestSchema), requestRiderWithdraw);
router.get('/rider/payout-account', requireRider, getRiderPayoutProfile);
router.post('/rider/payout-account', validateBody(payoutProfileSchema), saveRiderPayoutProfile);

module.exports = router;
