const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getVendorDashboard,
  getVendorPayoutProfile,
  getVendorWallet,
  requestVendorWithdraw,
  saveVendorPayoutProfile,
} = require('../controllers/financeController');
const {
  completeTrainingModule,
  getCustomVendorDashboard,
  getOwnCustomVendorProfile,
  getOwnCustomVendorQuality,
  listCustomOrderMessages,
  listCustomVendorOrders,
  saveOwnCustomVendorProfile,
  submitSampleReview,
  updateCustomOrderStatus,
} = require('../controllers/customVendorController');
const {
  getVendorTrialHomeDashboard,
  listVendorTrialHomeSessions,
  updateVendorTrialHomeSession,
  listVendorTrialHomeProductSettings,
  updateVendorTrialHomeProductSettings,
} = require('../controllers/trialHomeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/dashboard', getVendorDashboard);
router.get('/custom/dashboard', getCustomVendorDashboard);
router.get('/custom/profile', getOwnCustomVendorProfile);
router.get('/custom/quality', getOwnCustomVendorQuality);
router.post('/custom/profile', saveOwnCustomVendorProfile);
router.post('/custom/training/modules/:moduleKey/complete', completeTrainingModule);
router.post('/custom/sample-review', submitSampleReview);
router.get('/custom/orders', listCustomVendorOrders);
router.patch('/custom/orders/:orderId/status', updateCustomOrderStatus);
router.get('/custom/orders/:orderId/messages', listCustomOrderMessages);
router.get('/wallet', getVendorWallet);
router.post('/withdraw', requestVendorWithdraw);
router.get('/payout-account', getVendorPayoutProfile);
router.post('/payout-account', saveVendorPayoutProfile);
router.get('/trial-home/dashboard', getVendorTrialHomeDashboard);
router.get('/trial-home/sessions', listVendorTrialHomeSessions);
router.patch('/trial-home/:id/status', updateVendorTrialHomeSession);
router.get('/trial-home/settings/products', listVendorTrialHomeProductSettings);
router.patch('/trial-home/settings/products/:productId', updateVendorTrialHomeProductSettings);

module.exports = router;
