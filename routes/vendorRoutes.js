const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireVendor } = require('../middleware/authorizationMiddleware');
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
const {
  listVendorOperationsOrders,
  updateVendorOrderFlow,
  listVendorTrialRequests,
  updateVendorTrialFlow,
  getOperationsAnalytics,
  assignRider,
} = require('../controllers/logisticsController');
const {
  listVendorProducts,
  updateVendorProductPrice,
  bulkUpdateVendorProductPrices,
} = require('../controllers/productController');
const {
  getGrowthSummary,
  getGrowthRecommendations,
  getGrowthProductPerformance,
  getGrowthCharts,
} = require('../controllers/growthController');

const router = express.Router();

router.use(authMiddleware);

router.get('/products', requireVendor, listVendorProducts);
router.post('/product/price', requireVendor, updateVendorProductPrice);
router.post('/product/price/bulk', requireVendor, bulkUpdateVendorProductPrices);
router.get('/dashboard', requireVendor, getVendorDashboard);
router.get('/custom/dashboard', requireVendor, getCustomVendorDashboard);
router.get('/custom/profile', requireVendor, getOwnCustomVendorProfile);
router.get('/custom/quality', requireVendor, getOwnCustomVendorQuality);
router.post('/custom/profile', requireVendor, saveOwnCustomVendorProfile);
router.post('/custom/training/modules/:moduleKey/complete', requireVendor, completeTrainingModule);
router.post('/custom/sample-review', requireVendor, submitSampleReview);
router.get('/custom/orders', requireVendor, listCustomVendorOrders);
router.patch('/custom/orders/:orderId/status', requireVendor, updateCustomOrderStatus);
router.get('/custom/orders/:orderId/messages', requireVendor, listCustomOrderMessages);
router.get('/wallet', requireVendor, getVendorWallet);
router.post('/withdraw', requireVendor, requestVendorWithdraw);
router.get('/payout-account', requireVendor, getVendorPayoutProfile);
router.post('/payout-account', requireVendor, saveVendorPayoutProfile);
router.get('/trial-home/dashboard', requireVendor, getVendorTrialHomeDashboard);
router.get('/trial-home/sessions', requireVendor, listVendorTrialHomeSessions);
router.patch('/trial-home/:id/status', requireVendor, updateVendorTrialHomeSession);
router.get('/trial-home/settings/products', requireVendor, listVendorTrialHomeProductSettings);
router.patch('/trial-home/settings/products/:productId', requireVendor, updateVendorTrialHomeProductSettings);
router.get('/ops/orders', requireVendor, listVendorOperationsOrders);
router.patch('/ops/orders/:orderId/status', requireVendor, updateVendorOrderFlow);
router.get('/ops/trials', requireVendor, listVendorTrialRequests);
router.patch('/ops/trials/:sessionId/status', requireVendor, updateVendorTrialFlow);
router.post('/ops/assign-rider', requireVendor, assignRider);
router.get('/ops/analytics', requireVendor, getOperationsAnalytics);
router.get('/growth/summary', requireVendor, getGrowthSummary);
router.get('/growth/recommendations', requireVendor, getGrowthRecommendations);
router.get('/growth/product-performance', requireVendor, getGrowthProductPerformance);
router.get('/growth/charts', requireVendor, getGrowthCharts);

module.exports = router;
