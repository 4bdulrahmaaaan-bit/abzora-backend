const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const adminOnboardingAnalyticsController = require('../controllers/adminOnboardingAnalyticsController');
const { adminGetDrafts } = require('../controllers/vendorOnboardingDraftController');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  activityLogCreateSchema,
  adminNotificationSchema,
  cityQuerySchema,
  disputeUpdateSchema,
  fraudAlertUpdateSchema,
  kycReviewSchema,
  outboxDeadLetterReplaySchema,
  paginationQuerySchema,
  processPayoutSchema,
  processRefundSchema,
  runSettlementsSchema,
  simpleAdminIdBodySchema,
  statusQuerySchema,
  trialHomeUpdateSchema,
  userActionSchema,
  userRoleSchema,
  productActionSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const { rejectRequestSchema } = require('../validation/schemas/mutationSchemas');
const { createRateLimiter } = require('../middleware/securityMiddleware');
const {
  getDashboardSummary,
  listUsers,
  listStores,
  listProducts,
  listOrders,
  getPlatformSettings,
  savePlatformSettings,
  listPayouts,
  processPayout,
  listActivityLogs,
  createActivityLog,
  listVendorKycRequests,
  listRiderKycRequests,
  approveVendor,
  fixVendorStore,
  reviewVendorKycRequest,
  reviewRiderKycRequest,
  listTrialHomeSessions,
  getTrialHomeSession,
  updateTrialHomeSession,
  deleteVendor,
  applyUserAction,
  updateUserRole,
  applyProductAction,
} = require('../controllers/adminController');
const {
  getDisputesDashboard,
  listDisputes,
  getDispute,
  updateDispute,
  escalateDispute,
  resolveDispute,
} = require('../controllers/adminDisputeController');
const {
  sendNotification,
  scheduleNotification,
  getNotificationHistory,
  getNotificationTemplates,
} = require('../controllers/adminNotificationController');
const {
  getSystemHealth,
} = require('../controllers/adminSystemHealthController');
const {
  listAutomations,
  toggleAutomation,
  updateAutomationSchedule,
} = require('../controllers/adminAutomationController');
const {
  listBackups,
  triggerManualBackup,
  restoreBackup,
} = require('../controllers/adminBackupController');
const {
  getSecurityDashboard,
  revokeAccess,
} = require('../controllers/adminSecurityController');
const {
  getCouponsDashboard,
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
} = require('../controllers/adminCouponController');
const {
  getBusinessAnalyticsV2,
} = require('../controllers/adminBusinessAnalyticsController');
const {
  getConfig,
  updateConfig,
  getConfigHistory,
} = require('../controllers/adminConfigurationController');
const {
  getDashboard: getFinanceDashboard,
  getSettlements,
  getRefunds,
  getReports,
  processRefund,
} = require('../controllers/adminFinanceController');
const {
  getDashboard: getInventoryDashboard,
  getProducts: getInventoryProducts,
  adjustInventory,
} = require('../controllers/adminInventoryController');
const {
  getDashboard: getKycDashboard,
  getKycApplications,
  reviewKycApplication,
} = require('../controllers/adminKycController');
const {
  getDashboard: getRiderDashboard,
  getRidersList: getRiderIntelligenceList,
} = require('../controllers/adminRiderController');
const {
  approvePendingWithdrawal,
  getAdminFinance,
  rejectPendingWithdrawal,
  runScheduledSettlements,
  settleVendorPayouts,
  settleRiderPayouts,
  updateFraudAlertStatus,
} = require('../controllers/financeController');
const {
  getAdminHomeVisualConfig,
  saveAdminHomeVisualConfig,
} = require('../controllers/homeVisualController');
const {
  listProductAttributeTemplates,
  getProductAttributeTemplate,
  upsertProductAttributeTemplate,
  deleteProductAttributeTemplate,
} = require('../controllers/productAttributeTemplateController');
const {
  getCmsEntries,
  createCmsEntry,
  updateCmsEntry,
  deleteCmsEntry,
  toggleCmsStatus,
  reorderCmsEntries,
} = require('../controllers/cmsController');
const {
  getAdminPricing,
  simulateAdminPricing,
  updateAdminPricing,
  updateAdminPricingCommission,
  updateAdminPricingDelivery,
  updateAdminPricingDiscount,
  updateAdminPricingRider,
  updateAdminPricingScope,
  updateAdminPricingTrial,
} = require('../controllers/pricingAdminController');
const {
  overrideDispatch,
  freezeZone,
  unfreezeZone,
  prioritizeOrder,
  listZones,
} = require('../controllers/opsController');
const { replayDeadLetterEvent } = require('../controllers/outboxReplayAdminController');
const {
  getTrialDashboardMetrics,
  getTrialQueueHandler,
  getTrialDetailsHandler,
  getTrialAnalyticsHandler,
  assignRider,
  reschedule,
  cancelTrial,
  markPurchased,
  markReturned,
} = require('../controllers/adminTrialController');
const {
  getDashboard: getOrderDashboard,
  getQueue: getOrderQueue,
  getOrderDetails,
  getOrderTimeline,
  getOrderHistory,
} = require('../controllers/adminOrderController');
const {
  getDashboard: getVendorDashboard,
  getVendorDetails,
  getVendorAnalytics,
  getVendorPayouts,
  getVendorComplaints,
} = require('../controllers/adminVendorController');
const {
  getDashboard: getFraudDashboard,
  actionEntity: actionFraudEntity,
} = require('../controllers/adminFraudController');

const router = express.Router();
const outboxReplayLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many dead-letter replay attempts. Please try again later.',
});

router.use(authMiddleware, requireAdmin);

router.get('/dashboard', getDashboardSummary);
router.get('/system-health', getSystemHealth);

router.get('/automations', listAutomations);
router.patch('/automations/:id/toggle', toggleAutomation);
router.patch('/automations/:id/schedule', updateAutomationSchedule);

router.get('/backups', listBackups);
router.post('/backups/trigger', triggerManualBackup);
router.post('/backups/restore', restoreBackup);

router.get('/security/dashboard', getSecurityDashboard);
router.post('/security/revoke-access', revokeAccess);

// â”€â”€â”€ Trial Command Center â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/trials/dashboard', getTrialDashboardMetrics);
router.get('/trials/queue', getTrialQueueHandler);
router.get('/trials/analytics', getTrialAnalyticsHandler);
router.get('/trials/:id', getTrialDetailsHandler);
router.patch('/trials/:id/assign-rider', assignRider);
router.patch('/trials/:id/reschedule', reschedule);
router.patch('/trials/:id/cancel', cancelTrial);
router.patch('/trials/:id/mark-purchased', markPurchased);
router.patch('/trials/:id/mark-returned', markReturned);
router.get('/users', validateQuery(paginationQuerySchema), listUsers);
router.post('/users/:id/action', validateBody(userActionSchema), applyUserAction);
router.post('/users/:id/role', validateBody(userRoleSchema), updateUserRole);
router.get('/stores', validateQuery(paginationQuerySchema), listStores);
router.get('/products', validateQuery(paginationQuerySchema), listProducts);
router.post('/products/:id/action', validateBody(productActionSchema), applyProductAction);
router.get('/orders', validateQuery(paginationQuerySchema), listOrders);

// â”€â”€â”€ Order Management V2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/orders/dashboard', getOrderDashboard);
router.get('/orders/queue', getOrderQueue);
router.get('/orders/:id', getOrderDetails);
router.get('/orders/:id/timeline', getOrderTimeline);
router.get('/orders/:id/history', getOrderHistory);

// â”€â”€â”€ Vendor Intelligence V2 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/vendors/dashboard', getVendorDashboard);
router.get('/vendors/:id', getVendorDetails);
router.get('/vendors/:id/analytics', getVendorAnalytics);
router.get('/vendors/:id/payouts', getVendorPayouts);
router.get('/vendors/:id/complaints', getVendorComplaints);
router.delete('/vendors/:id', deleteVendor);

// â”€â”€â”€ Fraud & Risk Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/fraud/dashboard', getFraudDashboard);
router.post('/fraud/:type/:id/action', actionFraudEntity);

router.get('/settings', getPlatformSettings);
router.put('/settings', savePlatformSettings);
router.post('/notifications/send', validateBody(adminNotificationSchema), sendNotification);
router.post('/notifications/schedule', validateBody(adminNotificationSchema), scheduleNotification);
router.get('/notifications/history', validateQuery(paginationQuerySchema), getNotificationHistory);
router.get('/notifications/templates', getNotificationTemplates);
router.get('/coupons/dashboard', getCouponsDashboard);
router.get('/coupons', validateQuery(paginationQuerySchema), listCoupons);
router.post('/coupons', createCoupon);
router.patch('/coupons/:id', updateCoupon);
router.delete('/coupons/:id', deleteCoupon);
router.get('/business-analytics/v2', getBusinessAnalyticsV2);

router.get('/config', getConfig);
router.patch('/config', updateConfig);
router.get('/config/history', validateQuery(paginationQuerySchema), getConfigHistory);

router.get('/finance/dashboard', getFinanceDashboard);
router.get('/finance/settlements', validateQuery(paginationQuerySchema), getSettlements);
router.get('/finance/refunds', validateQuery(paginationQuerySchema), getRefunds);
router.post('/finance/refunds/process', validateBody(processRefundSchema), processRefund);
router.get('/finance/reports', getReports);

router.get('/inventory/dashboard', getInventoryDashboard);
router.get('/inventory/products', validateQuery(paginationQuerySchema), getInventoryProducts);
router.patch('/inventory/:id/adjust', adjustInventory);

router.get('/kyc/dashboard', getKycDashboard);
router.get('/kyc/applications', validateQuery(paginationQuerySchema), getKycApplications);
router.patch('/kyc/:id/review', reviewKycApplication);

// â”€â”€â”€ Onboarding Analytics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/onboarding-analytics/dashboard', adminOnboardingAnalyticsController.getDashboard.bind(adminOnboardingAnalyticsController));
router.get('/onboarding-analytics/vendor-funnel', adminOnboardingAnalyticsController.getVendorFunnel.bind(adminOnboardingAnalyticsController));
router.get('/onboarding-analytics/rider-funnel', adminOnboardingAnalyticsController.getRiderFunnel.bind(adminOnboardingAnalyticsController));
router.get('/onboarding-analytics/dropoffs', adminOnboardingAnalyticsController.getDropoffs.bind(adminOnboardingAnalyticsController));
router.get('/onboarding-analytics/approval-times', adminOnboardingAnalyticsController.getApprovalTimes.bind(adminOnboardingAnalyticsController));
router.post('/onboarding-analytics/alert-config', adminOnboardingAnalyticsController.updateAlertConfig.bind(adminOnboardingAnalyticsController));

router.get('/rider-intelligence/dashboard', getRiderDashboard);
router.get('/rider-intelligence/list', validateQuery(paginationQuerySchema), getRiderIntelligenceList);

router.get('/payouts', validateQuery(paginationQuerySchema), listPayouts);
router.post('/payouts/process', validateBody(processPayoutSchema), processPayout);
router.get('/finance', getAdminFinance);
router.get('/pricing', getAdminPricing);
router.post('/pricing/update', updateAdminPricing);
router.post('/pricing', updateAdminPricingScope);
router.post('/pricing/commission', updateAdminPricingCommission);
router.post('/pricing/delivery', updateAdminPricingDelivery);
router.post('/pricing/trial', updateAdminPricingTrial);
router.post('/pricing/discount', updateAdminPricingDiscount);
router.post('/pricing/rider', updateAdminPricingRider);
router.post('/pricing/simulate', simulateAdminPricing);
router.post('/finance/settlements/vendors', settleVendorPayouts);
router.post('/finance/settlements/riders', settleRiderPayouts);
router.post('/finance/settlements/run', validateBody(runSettlementsSchema), runScheduledSettlements);
router.post('/finance/withdrawals/:requestId/approve', approvePendingWithdrawal);
router.post('/finance/withdrawals/:requestId/reject', validateBody(rejectRequestSchema), rejectPendingWithdrawal);
router.patch('/finance/fraud-alerts/:alertId', validateBody(fraudAlertUpdateSchema), updateFraudAlertStatus);
router.get('/home-visuals', getAdminHomeVisualConfig);
router.put('/home-visuals', saveAdminHomeVisualConfig);
router.get('/cms', getCmsEntries);
router.post('/cms', createCmsEntry);
router.patch('/cms/reorder', reorderCmsEntries);
router.put('/cms/:id', updateCmsEntry);
router.patch('/cms/:id/status', toggleCmsStatus);
router.delete('/cms/:id', deleteCmsEntry);
router.get('/product-attribute-templates', listProductAttributeTemplates);
router.get('/product-attribute-templates/:templateKey', getProductAttributeTemplate);
router.put('/product-attribute-templates/:templateKey', upsertProductAttributeTemplate);
router.delete('/product-attribute-templates/:templateKey', deleteProductAttributeTemplate);
router.get('/disputes/dashboard', getDisputesDashboard);
router.get('/disputes', validateQuery(paginationQuerySchema), listDisputes);
router.get('/disputes/:id', getDispute);
router.patch('/disputes/:id', validateBody(disputeUpdateSchema), updateDispute);
router.post('/disputes/:id/escalate', escalateDispute);
router.post('/disputes/:id/resolve', resolveDispute);
router.get('/activity-logs', validateQuery(paginationQuerySchema), listActivityLogs);
router.post('/activity-logs', validateBody(activityLogCreateSchema), createActivityLog);
router.get('/kyc/vendors', validateQuery(statusQuerySchema), listVendorKycRequests);
router.get('/kyc/riders', validateQuery(statusQuerySchema), listRiderKycRequests);
router.get('/trial-home', validateQuery(statusQuerySchema), listTrialHomeSessions);
router.get('/trial-home/:id', getTrialHomeSession);
router.patch('/trial-home/:id', validateBody(trialHomeUpdateSchema), updateTrialHomeSession);
router.post('/approve-vendor', validateBody(simpleAdminIdBodySchema), approveVendor);
router.post('/fix-vendor-store', validateBody(simpleAdminIdBodySchema), fixVendorStore);
router.patch('/kyc/vendors/:id/review', validateBody(kycReviewSchema), reviewVendorKycRequest);
router.patch('/kyc/riders/:id/review', validateBody(kycReviewSchema), reviewRiderKycRequest);
router.get('/zones', validateQuery(cityQuerySchema), listZones);
router.post('/override-dispatch', overrideDispatch);
router.post('/freeze-zone', freezeZone);
router.post('/unfreeze-zone', unfreezeZone);
router.post('/prioritize-order', prioritizeOrder);
router.post(
  '/outbox/dead-letter/:eventId/replay',
  outboxReplayLimiter,
  validateBody(outboxDeadLetterReplaySchema),
  replayDeadLetterEvent,
);

router.get('/vendor-drafts', adminGetDrafts);

module.exports = router;
