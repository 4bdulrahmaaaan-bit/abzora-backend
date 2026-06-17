const express = require('express');

const { requireAdmin, requireRider, requireVendor } = require('../middleware/authorizationMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  fraudAlertUpdateSchema,
  runSettlementsSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  getAdminFinance,
  listAdminWithdrawals,
  exportAdminWithdrawalsCsv,
  exportAdminWithdrawalsXlsx,
  getVendorDashboard,
  getRiderDashboard,
  runScheduledSettlements,
  updateFraudAlertStatus,
} = require('../controllers/financeController');

const router = express.Router();

router.get('/overview', requireAdmin, getAdminFinance);
router.get('/withdrawals', requireAdmin, listAdminWithdrawals);
router.get('/withdrawals/export/csv', requireAdmin, exportAdminWithdrawalsCsv);
router.get('/withdrawals/export/xlsx', requireAdmin, exportAdminWithdrawalsXlsx);
router.get('/vendor/dashboard', requireVendor, getVendorDashboard);
router.get('/rider/dashboard', requireRider, getRiderDashboard);
router.post('/settlements/run', requireAdmin, validateBody(runSettlementsSchema), runScheduledSettlements);
router.patch('/fraud-alerts/:alertId', requireAdmin, validateBody(fraudAlertUpdateSchema), updateFraudAlertStatus);

module.exports = router;
