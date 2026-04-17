const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
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

router.get('/dashboard', getRiderDashboard);
router.get('/wallet', getRiderWallet);
router.post('/withdraw', requestRiderWithdraw);
router.get('/payout-account', getRiderPayoutProfile);
router.post('/payout-account', saveRiderPayoutProfile);
router.get('/tasks', listRiderTasks);
router.get('/tasks/active', listRiderActiveTasks);
router.patch('/tasks/:taskId/status', updateRiderTaskStatus);
router.post('/tracking/location', postLocationUpdate);

module.exports = router;
