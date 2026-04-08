const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const {
  getAdminFinance,
  getVendorDashboard,
  getRiderDashboard,
  runScheduledSettlements,
  updateFraudAlertStatus,
} = require('../controllers/financeController');

const router = express.Router();

router.use(authMiddleware);

router.get('/overview', getAdminFinance);
router.get('/vendor/dashboard', getVendorDashboard);
router.get('/rider/dashboard', getRiderDashboard);
router.post('/settlements/run', runScheduledSettlements);
router.patch('/fraud-alerts/:alertId', updateFraudAlertStatus);

module.exports = router;

