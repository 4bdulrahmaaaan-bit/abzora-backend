const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  acceptDelivery,
  createOrder,
  listUserOrders,
  listAssignedDeliveryOrders,
  listAvailableDeliveryOrders,
  listStoreOrders,
  createRazorpayOrder,
  updateDeliveryStatus,
  updateOrderStatus,
  updateRiderLocation,
  verifyPayment,
} = require('../controllers/orderController');

const router = express.Router();

router.use(authMiddleware);

router.post('/', createOrder);
router.get('/', listUserOrders);
router.get('/deliveries/available', listAvailableDeliveryOrders);
router.get('/deliveries/assigned', listAssignedDeliveryOrders);
router.get('/store/:storeId', listStoreOrders);
router.post('/:id/accept-delivery', acceptDelivery);
router.post('/create-razorpay-order', createRazorpayOrder);
router.patch('/:id/delivery-status', updateDeliveryStatus);
router.patch('/:id/rider-location', updateRiderLocation);
router.patch('/:id/status', updateOrderStatus);
router.post('/verify-payment', verifyPayment);

module.exports = router;
