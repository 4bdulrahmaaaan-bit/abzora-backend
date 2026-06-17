const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  cityQuerySchema,
  opsAlertsQuerySchema,
  opsMapQuerySchema,
  opsMetricsQuerySchema,
  paginationQuerySchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
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
  listZones,
  refreshZones,
  freezeZone,
  unfreezeZone,
  prioritizeOrder,
  overrideDispatch,
  getOpsMapDashboard,
} = require('../controllers/opsController');

const router = express.Router();

const opsCriticalLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 80,
  message: 'Too many ops control requests. Please retry in a few minutes.',
});

router.use(authMiddleware, requireAdmin);

router.get('/alerts', validateQuery(opsAlertsQuerySchema), listPriorityAlerts);
router.get('/zones', validateQuery(cityQuerySchema), listZones);
router.get('/dashboard/map', validateQuery(opsMapQuerySchema), getOpsMapDashboard);
router.post('/zones/refresh', opsCriticalLimiter, refreshZones);
router.post('/zones/freeze', opsCriticalLimiter, freezeZone);
router.post('/zones/unfreeze', opsCriticalLimiter, unfreezeZone);
router.post('/orders/prioritize', opsCriticalLimiter, prioritizeOrder);
router.post('/override-dispatch', opsCriticalLimiter, overrideDispatch);
router.post('/detect', opsCriticalLimiter, runOpsDetectionNow);
router.post('/alerts/:alertId/action', opsCriticalLimiter, runAlertAction);
router.post('/orders/:orderId/reassign', opsCriticalLimiter, manualReassignOrder);
router.post('/orders/:orderId/cancel', opsCriticalLimiter, manualCancelOrder);
router.post('/dispatch/:orderId/force', opsCriticalLimiter, manualDispatchOrder);
router.post('/payments/:orderId/retry', opsCriticalLimiter, manualRetryPayment);

router.get('/live', getOpsLivePanel);
router.get('/metrics', validateQuery(opsMetricsQuerySchema), getOpsMetricsDashboard);
router.get('/logs', validateQuery(paginationQuerySchema), getOpsLogs);
router.post('/simulate', runOpsSimulation);

module.exports = router;
