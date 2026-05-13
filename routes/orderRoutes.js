const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  approveRefundRequestSchema,
  approveReturnRequestSchema,
  createReturnRequestSchema,
  rejectRequestSchema,
  updateDeliveryStatusSchema,
  updateOrderStatusSchema,
  updateRiderLocationSchema,
  verifyPaymentSchema,
} = require('../validation/schemas/mutationSchemas');
const { orderStatusListQuerySchema } = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  acceptDelivery,
  createAtelierOrder,
  createOrder,
  getOrderPricingQuote,
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

router.post('/quote', getOrderPricingQuote);
router.post('/atelier', createAtelierOrder);
router.post('/', createOrder);
router.post('/quick-checkout', quickCheckoutOrder);
router.get('/', listUserOrders);
router.get('/refund-requests', validateQuery(orderStatusListQuerySchema), listRefundRequests);
router.get('/return-requests', validateQuery(orderStatusListQuerySchema), listReturnRequests);
router.post('/refund-requests/:refundId/approve', validateBody(approveRefundRequestSchema), approveRefundRequest);
router.post('/refund-requests/:refundId/reject', validateBody(rejectRequestSchema), rejectRefundRequest);
router.post('/return-requests/:returnId/approve', validateBody(approveReturnRequestSchema), approveReturnRequest);
router.post('/return-requests/:returnId/reject', validateBody(rejectRequestSchema), rejectReturnRequest);
router.post('/return-requests/:returnId/picked', markReturnPicked);
router.post('/return-requests/:returnId/complete', completeReturnRequest);
router.get('/deliveries/available', listAvailableDeliveryOrders);
router.get('/deliveries/assigned', listAssignedDeliveryOrders);
router.get('/store/:storeId', listStoreOrders);
router.get('/:id/invoice.pdf', downloadOrderInvoicePdf);
router.get('/:id/refund-request', getRefundRequestForOrder);
router.post('/:id/refund-request', createRefundRequest);
router.get('/:id/return-request', getReturnRequestForOrder);
router.post('/:id/return-request', validateBody(createReturnRequestSchema), createReturnRequest);
router.post('/:id/custom-fit-feedback', submitCustomFitFeedback);
router.post('/:id/custom-alteration', requestCustomAlteration);
router.post('/:id/cancel', cancelOrder);
router.post('/:id/accept-delivery', acceptDelivery);
router.post('/create-razorpay-order', createRazorpayOrder);
router.patch('/:id/delivery-status', validateBody(updateDeliveryStatusSchema), updateDeliveryStatus);
router.patch('/:id/rider-location', validateBody(updateRiderLocationSchema), updateRiderLocation);
router.patch('/:id/status', validateBody(updateOrderStatusSchema), updateOrderStatus);
router.post('/verify-payment', validateBody(verifyPaymentSchema), verifyPayment);

module.exports = router;
