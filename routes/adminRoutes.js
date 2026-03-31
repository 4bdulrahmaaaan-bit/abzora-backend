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
  reviewVendorKycRequest,
  reviewRiderKycRequest,
} = require('../controllers/adminController');

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
router.get('/disputes', listDisputes);
router.patch('/disputes/:id', updateDispute);
router.get('/activity-logs', listActivityLogs);
router.post('/activity-logs', createActivityLog);
router.get('/kyc/vendors', listVendorKycRequests);
router.get('/kyc/riders', listRiderKycRequests);
router.post('/approve-vendor', approveVendor);
router.patch('/kyc/vendors/:id/review', reviewVendorKycRequest);
router.patch('/kyc/riders/:id/review', reviewRiderKycRequest);

module.exports = router;
