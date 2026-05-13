const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  bulkFleetActionSchema,
  cityQuerySchema,
  dispatchRecommendSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  getFleetDashboard,
  getFleetZones,
  getFleetAlerts,
  getRiderPerformance,
  dispatchRecommend,
  runFleetSimulation,
  runBulkFleetAction,
} = require('../controllers/fleetController');

const router = express.Router();

router.use(authMiddleware, requireAdmin);

router.get('/live-dashboard', getFleetDashboard);
router.get('/zones', validateQuery(cityQuerySchema), getFleetZones);
router.get('/alerts', getFleetAlerts);
router.get('/riders/performance', getRiderPerformance);
router.post('/dispatch/recommend', validateBody(dispatchRecommendSchema), dispatchRecommend);
router.post('/simulate', runFleetSimulation);
router.post('/bulk-actions', validateBody(bulkFleetActionSchema), runBulkFleetAction);

module.exports = router;
