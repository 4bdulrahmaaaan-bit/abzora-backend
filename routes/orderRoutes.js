const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  acceptDelivery,
  createOrder,
  quickCheckoutOrder,
  listUserOrders,
  listAssignedDeliveryOrders,
  listAvailableDeliveryOrders,
  listStoreOrders,
  getRefundRequestForOrder,
  listRefundRequests,
  createRefundRequest,
  approveRefundRequest,
  rejectRefundRequest,
  getReturnRequestForOrder,
  listReturnRequests,
  createReturnRequest,
  approveReturnRequest,
  rejectReturnRequest,
  markReturnPicked,
  completeReturnRequest,
  cancelOrder,
  createRazorpayOrder,
  downloadOrderInvoicePdf,
  requestCustomAlteration,
  submitCustomFitFeedback,
  updateDeliveryStatus,
  updateOrderStatus,
  updateRiderLocation,
  verifyPayment,
} = require('../controllers/orderController');

const router = express.Router();

router.use(authMiddleware);

router.post('/', createOrder);
router.post('/quick-checkout', quickCheckoutOrder);
router.get('/', listUserOrders);
router.get('/refund-requests', listRefundRequests);
router.get('/return-requests', listReturnRequests);
router.post('/refund-requests/:refundId/approve', approveRefundRequest);
router.post('/refund-requests/:refundId/reject', rejectRefundRequest);
router.post('/return-requests/:returnId/approve', approveReturnRequest);
router.post('/return-requests/:returnId/reject', rejectReturnRequest);
router.post('/return-requests/:returnId/picked', markReturnPicked);
router.post('/return-requests/:returnId/complete', completeReturnRequest);
router.get('/deliveries/available', listAvailableDeliveryOrders);
router.get('/deliveries/assigned', listAssignedDeliveryOrders);
router.get('/store/:storeId', listStoreOrders);
router.get('/:id/invoice.pdf', downloadOrderInvoicePdf);
router.get('/:id/refund-request', getRefundRequestForOrder);
router.post('/:id/refund-request', createRefundRequest);
router.get('/:id/return-request', getReturnRequestForOrder);
router.post('/:id/return-request', createReturnRequest);
router.post('/:id/custom-fit-feedback', submitCustomFitFeedback);
router.post('/:id/custom-alteration', requestCustomAlteration);
router.post('/:id/cancel', cancelOrder);
router.post('/:id/accept-delivery', acceptDelivery);
router.post('/create-razorpay-order', createRazorpayOrder);
router.patch('/:id/delivery-status', updateDeliveryStatus);
router.patch('/:id/rider-location', updateRiderLocation);
router.patch('/:id/status', updateOrderStatus);
router.post('/verify-payment', verifyPayment);

module.exports = router;
