const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getDashboardSummary,
  listUsers,
  listStores,
  listProducts,
  listOrders,
  listVendorKycRequests,
  listRiderKycRequests,
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
router.get('/kyc/vendors', listVendorKycRequests);
router.get('/kyc/riders', listRiderKycRequests);
router.patch('/kyc/vendors/:id/review', reviewVendorKycRequest);
router.patch('/kyc/riders/:id/review', reviewRiderKycRequest);

module.exports = router;
