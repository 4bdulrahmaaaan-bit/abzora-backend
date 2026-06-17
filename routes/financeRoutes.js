const express = require('express');

const { requireAdmin, requireRider, requireVendor } = require('../middleware/authorizationMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  fraudAlertUpdateSchema,
  runSettlementsSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  getAdminFinance,
  getPayoutRecoveryJobs,
  listAdminWithdrawals,
  exportAdminWithdrawalsCsv,
  exportAdminWithdrawalsXlsx,
  getVendorDashboard,
  getRiderDashboard,
  retryPayoutRecoveryJob,
  runScheduledSettlements,
  runPayoutRecoveryNow,
  updateFraudAlertStatus,
  exportPayoutRecoveryJobsCsv,
  exportPayoutRecoveryJobsXlsx,
} = require('../controllers/financeController');

const router = express.Router();

router.get('/overview', requireAdmin, getAdminFinance);
router.get('/withdrawals', requireAdmin, listAdminWithdrawals);
router.get('/withdrawals/export/csv', requireAdmin, exportAdminWithdrawalsCsv);
router.get('/withdrawals/export/xlsx', requireAdmin, exportAdminWithdrawalsXlsx);
router.get('/recovery/jobs', requireAdmin, getPayoutRecoveryJobs);
router.get('/recovery/jobs/export/csv', requireAdmin, exportPayoutRecoveryJobsCsv);
router.get('/recovery/jobs/export/xlsx', requireAdmin, exportPayoutRecoveryJobsXlsx);
router.post('/recovery/run', requireAdmin, runPayoutRecoveryNow);
router.post('/recovery/jobs/:jobId/retry', requireAdmin, retryPayoutRecoveryJob);
router.get('/vendor/dashboard', requireVendor, getVendorDashboard);
router.get('/rider/dashboard', requireRider, getRiderDashboard);
router.post('/settlements/run', requireAdmin, validateBody(runSettlementsSchema), runScheduledSettlements);
router.patch('/fraud-alerts/:alertId', requireAdmin, validateBody(fraudAlertUpdateSchema), updateFraudAlertStatus);

module.exports = router;
