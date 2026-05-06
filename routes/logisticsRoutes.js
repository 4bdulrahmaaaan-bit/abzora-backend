const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
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
} = require('../controllers/logisticsController');

const router = express.Router();

router.get('/delivery/check', checkDeliveryAvailability);
router.use(authMiddleware);
router.post('/assign-rider', assignRider);
router.post('/rider/assign', assignRiderForOrder);

router.get('/rider/tasks', listRiderTasks);
router.get('/rider/tasks/active', listRiderActiveTasks);
router.patch('/rider/tasks/:taskId/status', updateRiderTaskStatus);

router.get('/vendor/ops/orders', listVendorOperationsOrders);
router.patch('/vendor/ops/orders/:orderId/status', updateVendorOrderFlow);
router.get('/vendor/ops/trial-requests', listVendorTrialRequests);
router.patch('/vendor/ops/trial-requests/:sessionId/status', updateVendorTrialFlow);

router.post('/trial/request', createTrialAliasRequest);
router.post('/trial/update-status', trialAliasUpdateStatus);

router.get('/analytics/ops', getOperationsAnalytics);
router.get('/order/track/:id', trackOrder);

module.exports = router;
