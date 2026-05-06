const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin } = require('../middleware/authorizationMiddleware');
const {
  createAnalyticsEvent,
  fetchAnalyticsDashboard,
  fetchProductAnalytics,
  fetchPriceConversionChart,
  fetchDiscountSalesChart,
  fetchTimeSeriesChart,
  fetchAnalyticsSummary,
} = require('../controllers/analyticsController');

const router = express.Router();

router.post('/event', authMiddleware, createAnalyticsEvent);
router.get('/dashboard', authMiddleware, requireAdmin, fetchAnalyticsDashboard);
router.get('/product/:id', authMiddleware, fetchProductAnalytics);
router.get('/chart/price-conversion/:id', authMiddleware, fetchPriceConversionChart);
router.get('/chart/discount-sales/:id', authMiddleware, fetchDiscountSalesChart);
router.get('/chart/time-series/:id', authMiddleware, fetchTimeSeriesChart);
router.get('/summary', authMiddleware, fetchAnalyticsSummary);

module.exports = router;
