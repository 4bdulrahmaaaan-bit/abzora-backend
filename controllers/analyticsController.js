const { getDashboard } = require('../services/analyticsDashboardService');
const { trackEvent } = require('../services/analyticsService');
const { hasRole } = require('../middleware/authorizationMiddleware');

function getAuthenticatedUserId(req) {
  return req.user?.uid || req.user?.firebaseUid || req.user?.id || '';
}

async function createAnalyticsEvent(req, res, next) {
  try {
    const payload = await trackEvent({
      eventType: req.body?.eventType,
      userId: getAuthenticatedUserId(req),
      sessionId: req.body?.sessionId,
      productId: req.body?.productId,
      decisionId: req.body?.decisionId,
      cta: req.body?.cta,
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
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

module.exports = {
  createAnalyticsEvent,
  fetchAnalyticsDashboard,
};
