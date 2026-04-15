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

const router = express.Router();

router.use(authMiddleware);

router.get('/dashboard', getDashboardSummary);
router.get('/users', listUsers);
router.get('/stores', listStores);
router.get('/products', listProducts);
router.get('/orders', listOrders);
router.get('/settings', getPlatformSettings);
router.put('/settings', savePlatformSettings);
router.get('/notifications', listNotifications);
router.post('/notifications', createNotification);
router.get('/payouts', listPayouts);
router.post('/payouts/process', processPayout);
router.get('/finance', getAdminFinance);
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

module.exports = router;
