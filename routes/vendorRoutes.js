const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireVendor } = require('../middleware/authorizationMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  payoutProfileSchema,
  withdrawalRequestSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
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

const vendorNotificationController = require('../controllers/vendorNotificationController');
const couponController = require('../controllers/couponController');
const campaignController = require('../controllers/campaignController');
const promotionAnalyticsController = require('../controllers/promotionAnalyticsController');

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
router.post('/withdraw', requireVendor, validateBody(withdrawalRequestSchema), requestVendorWithdraw);
router.get('/payout-account', requireVendor, getVendorPayoutProfile);
router.post('/payout-account', requireVendor, validateBody(payoutProfileSchema), saveVendorPayoutProfile);
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

// Notifications
router.get('/notifications', requireVendor, vendorNotificationController.getNotifications);
router.get('/notifications/unread-count', requireVendor, vendorNotificationController.getUnreadCount);
router.patch('/notifications/read-all', requireVendor, vendorNotificationController.markAllAsRead);
router.patch('/notifications/:id/read', requireVendor, vendorNotificationController.markAsRead);

// Coupons
router.post('/coupons', requireVendor, couponController.createCoupon);
router.get('/coupons', requireVendor, couponController.getCoupons);
router.put('/coupons/:id', requireVendor, couponController.updateCoupon);
router.patch('/coupons/:id/status', requireVendor, couponController.updateStatus);
router.delete('/coupons/:id', requireVendor, couponController.deleteCoupon);

// Campaigns
router.post('/campaigns', requireVendor, campaignController.createCampaign);
router.get('/campaigns', requireVendor, campaignController.getCampaigns);
router.put('/campaigns/:id', requireVendor, campaignController.updateCampaign);
router.patch('/campaigns/:id/status', requireVendor, campaignController.updateStatus);
router.delete('/campaigns/:id', requireVendor, campaignController.deleteCampaign);

// Promotion Analytics
router.get('/promotion-analytics', requireVendor, promotionAnalyticsController.getAnalytics);

// Reviews
const reviewController = require('../controllers/reviewController');
router.get('/reviews', requireVendor, reviewController.getReviews);
router.get('/reviews/analytics', requireVendor, reviewController.getAnalytics);
router.post('/reviews/:reviewId/reply', requireVendor, reviewController.addReply);
router.patch('/reviews/:reviewId/reply', requireVendor, reviewController.editReply);
router.delete('/reviews/:reviewId/reply', requireVendor, reviewController.deleteReply);

// Returns
const returnsController = require('../controllers/returnsController');
router.get('/returns', requireVendor, returnsController.getReturns);
router.get('/returns/analytics', requireVendor, returnsController.getAnalytics);
router.patch('/returns/:id/status', requireVendor, returnsController.updateReturnStatus);

router.get('/refunds', requireVendor, returnsController.getRefunds);
router.patch('/refunds/:id/status', requireVendor, returnsController.updateRefundStatus);

router.get('/exchanges', requireVendor, returnsController.getExchanges);
router.patch('/exchanges/:id/status', requireVendor, returnsController.updateExchangeStatus);

// Support
const vendorSupportController = require('../controllers/vendorSupportController');
router.get('/support/tickets', requireVendor, vendorSupportController.getTickets);
router.post('/support/tickets', requireVendor, vendorSupportController.createTicket);
router.get('/support/tickets/:id', requireVendor, vendorSupportController.getTicket);
router.post('/support/tickets/:id/messages', requireVendor, vendorSupportController.addMessage);
router.patch('/support/tickets/:id/status', requireVendor, vendorSupportController.updateTicketStatus);
router.get('/support/analytics', requireVendor, vendorSupportController.getAnalytics);

// Business Health
const businessHealthController = require('../controllers/businessHealthController');
router.get('/business-health', requireVendor, businessHealthController.getHealth);
router.post('/business-health/recalculate', requireVendor, businessHealthController.recalculateHealth);

module.exports = router;
