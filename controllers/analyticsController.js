const { getDashboard } = require('../services/analyticsDashboardService');
const { trackEvent } = require('../services/analyticsService');

async function createAnalyticsEvent(req, res, next) {
  try {
    const payload = await trackEvent({
      eventType: req.body?.eventType,
      userId: req.body?.userId || req.user?.uid || '',
      sessionId: req.body?.sessionId,
      productId: req.body?.productId,
      decisionId: req.body?.decisionId,
      cta: req.body?.cta,
      metadata: req.body?.metadata,
      timestamp: req.body?.timestamp,
    });

    return res.status(201).json({ success: true, data: payload });
  } catch (error) {
    return next(error);
  }
}

async function fetchAnalyticsDashboard(req, res, next) {
  try {
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
