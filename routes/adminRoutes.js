const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  activityLogCreateSchema,
  adminNotificationSchema,
  cityQuerySchema,
  disputeUpdateSchema,
  fraudAlertUpdateSchema,
  kycReviewSchema,
  paginationQuerySchema,
  processPayoutSchema,
  runSettlementsSchema,
  simpleAdminIdBodySchema,
  statusQuerySchema,
  trialHomeUpdateSchema,
  userActionSchema,
  userRoleSchema,
  productActionSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const { rejectRequestSchema } = require('../validation/schemas/mutationSchemas');
const {
  getDashboardSummary,
  listUsers,
  listStores,
  listProducts,
  listOrders,
  getPlatformSettings,
  savePlatformSettings,
  listNotifications,
  createNotification,
  listPayouts,
  processPayout,
  listDisputes,
  updateDispute,
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
  applyUserAction,
  updateUserRole,
  applyProductAction,
} = require('../controllers/adminController');
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

const router = express.Router();

router.use(authMiddleware);

router.get('/dashboard', getDashboardSummary);
router.get('/users', validateQuery(paginationQuerySchema), listUsers);
router.post('/users/:id/action', validateBody(userActionSchema), applyUserAction);
router.post('/users/:id/role', validateBody(userRoleSchema), updateUserRole);
router.get('/stores', validateQuery(paginationQuerySchema), listStores);
router.get('/products', validateQuery(paginationQuerySchema), listProducts);
router.post('/products/:id/action', validateBody(productActionSchema), applyProductAction);
router.get('/orders', validateQuery(paginationQuerySchema), listOrders);
router.get('/settings', getPlatformSettings);
router.put('/settings', savePlatformSettings);
router.get('/notifications', validateQuery(paginationQuerySchema), listNotifications);
router.post('/notifications', validateBody(adminNotificationSchema), createNotification);
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
router.get('/disputes', validateQuery(paginationQuerySchema), listDisputes);
router.patch('/disputes/:id', validateBody(disputeUpdateSchema), updateDispute);
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

module.exports = router;
