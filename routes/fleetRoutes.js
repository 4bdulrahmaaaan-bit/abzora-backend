const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
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
router.get('/zones', getFleetZones);
router.get('/alerts', getFleetAlerts);
router.get('/riders/performance', getRiderPerformance);
router.post('/dispatch/recommend', dispatchRecommend);
router.post('/simulate', runFleetSimulation);
router.post('/bulk-actions', runBulkFleetAction);

module.exports = router;
