const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
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
router.get('/users', listUsers);
router.post('/users/:id/action', applyUserAction);
router.post('/users/:id/role', updateUserRole);
router.get('/stores', listStores);
router.get('/products', listProducts);
router.post('/products/:id/action', applyProductAction);
router.get('/orders', listOrders);
router.get('/settings', getPlatformSettings);
router.put('/settings', savePlatformSettings);
router.get('/notifications', listNotifications);
router.post('/notifications', createNotification);
router.get('/payouts', listPayouts);
router.post('/payouts/process', processPayout);
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
router.post('/finance/settlements/run', runScheduledSettlements);
router.post('/finance/withdrawals/:requestId/approve', approvePendingWithdrawal);
router.post('/finance/withdrawals/:requestId/reject', rejectPendingWithdrawal);
router.patch('/finance/fraud-alerts/:alertId', updateFraudAlertStatus);
router.get('/home-visuals', getAdminHomeVisualConfig);
router.put('/home-visuals', saveAdminHomeVisualConfig);
router.get('/disputes', listDisputes);
router.patch('/disputes/:id', updateDispute);
router.get('/activity-logs', listActivityLogs);
router.post('/activity-logs', createActivityLog);
router.get('/kyc/vendors', listVendorKycRequests);
router.get('/kyc/riders', listRiderKycRequests);
router.get('/trial-home', listTrialHomeSessions);
router.get('/trial-home/:id', getTrialHomeSession);
router.patch('/trial-home/:id', updateTrialHomeSession);
router.post('/approve-vendor', approveVendor);
router.post('/fix-vendor-store', fixVendorStore);
router.patch('/kyc/vendors/:id/review', reviewVendorKycRequest);
router.patch('/kyc/riders/:id/review', reviewRiderKycRequest);
router.get('/zones', listZones);
router.post('/override-dispatch', overrideDispatch);
router.post('/freeze-zone', freezeZone);
router.post('/unfreeze-zone', unfreezeZone);
router.post('/prioritize-order', prioritizeOrder);

module.exports = router;
