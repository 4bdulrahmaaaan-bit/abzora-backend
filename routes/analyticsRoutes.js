const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const {
  createAnalyticsEvent,
  fetchAnalyticsDashboard,
} = require('../controllers/analyticsController');

const router = express.Router();

router.post('/event', createAnalyticsEvent);
router.get('/dashboard', authMiddleware, requireAdmin, fetchAnalyticsDashboard);

module.exports = router;
