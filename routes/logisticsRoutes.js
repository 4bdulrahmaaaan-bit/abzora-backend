const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { validateQuery } = require('../validation/schemaValidator');
const {
  logisticsDeliveryCheckQuerySchema,
  logisticsVendorOrdersQuerySchema,
  logisticsVendorTrialsQuerySchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  assignRider,
  assignRiderForOrder,
  listRiderTasks,
  listRiderActiveTasks,
  updateRiderTaskStatus,
  listVendorOperationsOrders,
  updateVendorOrderFlow,
  listVendorTrialRequests,
  updateVendorTrialFlow,
  createTrialAliasRequest,
  trialAliasUpdateStatus,
  getOperationsAnalytics,
  checkDeliveryAvailability,
  trackOrder,
  scheduleShiprocketPickup,
  getShiprocketTracking,
} = require('../controllers/logisticsController');

const router = express.Router();

router.get('/delivery/check', validateQuery(logisticsDeliveryCheckQuerySchema), checkDeliveryAvailability);
router.use(authMiddleware);
router.post('/assign-rider', assignRider);
router.post('/rider/assign', assignRiderForOrder);

router.get('/rider/tasks', listRiderTasks);
router.get('/rider/tasks/active', listRiderActiveTasks);
router.patch('/rider/tasks/:taskId/status', updateRiderTaskStatus);

router.get('/vendor/ops/orders', validateQuery(logisticsVendorOrdersQuerySchema), listVendorOperationsOrders);
router.patch('/vendor/ops/orders/:orderId/status', updateVendorOrderFlow);
router.get('/vendor/ops/trial-requests', validateQuery(logisticsVendorTrialsQuerySchema), listVendorTrialRequests);
router.patch('/vendor/ops/trial-requests/:sessionId/status', updateVendorTrialFlow);

router.post('/trial/request', createTrialAliasRequest);
router.post('/trial/update-status', trialAliasUpdateStatus);

router.get('/analytics/ops', getOperationsAnalytics);
router.get('/order/track/:id', trackOrder);

router.post('/shiprocket/pickup', scheduleShiprocketPickup);
router.get('/shiprocket/track/:orderId', getShiprocketTracking);

module.exports = router;
