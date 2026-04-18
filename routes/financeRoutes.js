const express = require('express');

const { requireAdmin, requireRider, requireVendor } = require('../middleware/authorizationMiddleware');
const {
  getAdminFinance,
  getVendorDashboard,
  getRiderDashboard,
  runScheduledSettlements,
  updateFraudAlertStatus,
} = require('../controllers/financeController');

const router = express.Router();

router.get('/overview', requireAdmin, getAdminFinance);
router.get('/vendor/dashboard', requireVendor, getVendorDashboard);
router.get('/rider/dashboard', requireRider, getRiderDashboard);
router.post('/settlements/run', requireAdmin, runScheduledSettlements);
router.patch('/fraud-alerts/:alertId', requireAdmin, updateFraudAlertStatus);

module.exports = router;
