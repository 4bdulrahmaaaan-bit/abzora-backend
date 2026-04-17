const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  createRateLimiter,
} = require('../middleware/securityMiddleware');
const {
  listPriorityAlerts,
  runOpsDetectionNow,
  runAlertAction,
  manualReassignOrder,
  manualCancelOrder,
  manualDispatchOrder,
  manualRetryPayment,
  getOpsLogs,
  getOpsMetricsDashboard,
  getOpsLivePanel,
  runOpsSimulation,
} = require('../controllers/opsController');

const router = express.Router();

const opsCriticalLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 80,
  message: 'Too many ops control requests. Please retry in a few minutes.',
});

router.use(authMiddleware);

router.get('/alerts', listPriorityAlerts);
router.post('/detect', opsCriticalLimiter, runOpsDetectionNow);
router.post('/alerts/:alertId/action', opsCriticalLimiter, runAlertAction);
router.post('/orders/:orderId/reassign', opsCriticalLimiter, manualReassignOrder);
router.post('/orders/:orderId/cancel', opsCriticalLimiter, manualCancelOrder);
router.post('/dispatch/:orderId/force', opsCriticalLimiter, manualDispatchOrder);
router.post('/payments/:orderId/retry', opsCriticalLimiter, manualRetryPayment);

router.get('/live', getOpsLivePanel);
router.get('/metrics', getOpsMetricsDashboard);
router.get('/logs', getOpsLogs);
router.post('/simulate', runOpsSimulation);

module.exports = router;
