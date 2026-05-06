const { getDashboard } = require('../services/analyticsDashboardService');
const {
  trackEvent,
  getProductAnalyticsSummary,
  getPriceConversionChart,
  getDiscountSalesChart,
  getTimeSeriesChart,
  getAnalyticsSummary,
} = require('../services/analyticsService');
const { hasRole } = require('../middleware/authorizationMiddleware');

function getAuthenticatedUserId(req) {
  return req.user?.uid || req.user?.firebaseUid || req.user?.id || '';
}

async function createAnalyticsEvent(req, res, next) {
  try {
    const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
    if (req.body?.price_shown != null && metadata.price_shown == null) {
      metadata.price_shown = req.body.price_shown;
    }
    if (req.body?.discount_shown != null && metadata.discount_shown == null) {
      metadata.discount_shown = req.body.discount_shown;
    }
    const payload = await trackEvent({
      eventType: req.body?.eventType || req.body?.event_type,
      userId: getAuthenticatedUserId(req),
      sessionId: req.body?.sessionId || req.body?.session_id,
      productId: req.body?.productId || req.body?.product_id,
      decisionId: req.body?.decisionId || req.body?.decision_id,
      cta: req.body?.cta,
      metadata,
      timestamp: req.body?.timestamp,
    });

    return res.status(201).json({ success: true, data: payload });
  } catch (error) {
    return next(error);
  }
}

async function fetchAnalyticsDashboard(req, res, next) {
  try {
    if (!hasRole(req.user, ['admin', 'super_admin'])) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const data = await getDashboard({
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function fetchProductAnalytics(req, res, next) {
  try {
    const productId = req.params?.id || '';
    const data = await getProductAnalyticsSummary(productId, {
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function fetchPriceConversionChart(req, res, next) {
  try {
    const data = await getPriceConversionChart(req.params?.id || '', {
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function fetchDiscountSalesChart(req, res, next) {
  try {
    const data = await getDiscountSalesChart(req.params?.id || '', {
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function fetchTimeSeriesChart(req, res, next) {
  try {
    const data = await getTimeSeriesChart(req.params?.id || '', {
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function fetchAnalyticsSummary(req, res, next) {
  try {
    const data = await getAnalyticsSummary({
      from: req.query?.from,
      to: req.query?.to,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createAnalyticsEvent,
  fetchAnalyticsDashboard,
  fetchProductAnalytics,
  fetchPriceConversionChart,
  fetchDiscountSalesChart,
  fetchTimeSeriesChart,
  fetchAnalyticsSummary,
};
