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
  getOptimizedRiderRoute,
} = require('../controllers/logisticsController');
const {
  postLocationUpdate,
} = require('../controllers/trackingController');
const {
  getAssignedTrials,
  getActiveTrials,
  getCompletedTrials,
  arriveTrial,
  startTrial,
  calculateCheckout,
  completeTrial,
  noShowTrial
} = require('../controllers/riderTrialController');

const {
  getEarnings,
  getEarningsSummary,
  getPerformance,
  getIncentives,
  getPayouts,
  getPayoutHistory,
  getAnalytics
} = require('../controllers/riderPlatformController');

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
router.get('/route', requireRider, getOptimizedRiderRoute);
router.post('/tracking/location', requireRider, postLocationUpdate);

router.get('/trials/assigned', requireRider, getAssignedTrials);
router.get('/trials/active', requireRider, getActiveTrials);
router.get('/trials/completed', requireRider, getCompletedTrials);
router.post('/trials/:id/arrive', requireRider, arriveTrial);
router.post('/trials/:id/start', requireRider, startTrial);
router.post('/trials/:id/checkout', requireRider, calculateCheckout);
router.post('/trials/:id/complete', requireRider, completeTrial);
router.post('/trials/:id/no-show', requireRider, noShowTrial);

// Phase 3: Earnings & Performance Platform
router.get('/earnings', requireRider, getEarnings);
router.get('/earnings/summary', requireRider, getEarningsSummary);

router.get('/performance', requireRider, getPerformance);
router.get('/performance/incentives', requireRider, getIncentives);

router.get('/payouts', requireRider, getPayouts);
router.get('/payouts/history', requireRider, getPayoutHistory);

router.get('/analytics', requireRider, getAnalytics);

module.exports = router;
