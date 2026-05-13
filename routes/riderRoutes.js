const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireRider } = require('../middleware/authorizationMiddleware');
const { validateBody } = require('../validation/schemaValidator');
const {
  payoutProfileSchema,
  withdrawalRequestSchema,
} = require('../validation/schemas/adminFinanceOpsSchemas');
const {
  getRiderDashboard,
  getRiderPayoutProfile,
  getRiderWallet,
  requestRiderWithdraw,
  saveRiderPayoutProfile,
} = require('../controllers/financeController');
const {
  listRiderTasks,
  listRiderActiveTasks,
  updateRiderTaskStatus,
} = require('../controllers/logisticsController');
const {
  postLocationUpdate,
} = require('../controllers/trackingController');

const router = express.Router();

router.use(authMiddleware);

router.get('/dashboard', requireRider, getRiderDashboard);
router.get('/wallet', requireRider, getRiderWallet);
router.post('/withdraw', requireRider, validateBody(withdrawalRequestSchema), requestRiderWithdraw);
router.get('/payout-account', requireRider, getRiderPayoutProfile);
router.post('/payout-account', requireRider, validateBody(payoutProfileSchema), saveRiderPayoutProfile);
router.get('/tasks', requireRider, listRiderTasks);
router.get('/tasks/active', requireRider, listRiderActiveTasks);
router.patch('/tasks/:taskId/status', requireRider, updateRiderTaskStatus);
router.post('/tracking/location', requireRider, postLocationUpdate);

module.exports = router;
