function normalizePercent(value) {
  const n = Number(value || 0);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

function normalizeCount(value, max = 10) {
  const n = Number(value || 0);
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.max(0, Math.min(100, (n / max) * 100));
}

function getRiskLevel(score) {
  if (score <= 30) return 'Low';
  if (score <= 70) return 'Medium';
  return 'High';
}

function getRecommendation(score) {
  if (score < 25) return 'Auto approve';
  if (score <= 30) return 'Approve';
  if (score <= 70) return 'Manual review';
  return 'Reject';
}

async function scoreTrialRisk(req, res, next) {
  try {
    const user = req.body?.user || {};
    const session = req.body?.session || {};
    const product = req.body?.product || {};
    const location = req.body?.location || {};
    const device = req.body?.device || {};

    const returnRate = normalizePercent(user.return_rate);
    const cancellations = normalizeCount(user.cancellations, 8);
    const deviceRisk =
      device.suspicious_activity || device.multiple_accounts
        ? 100
        : normalizeCount(device.risk_signals, 5);
    const locationRisk = normalizePercent(location.zone_risk || location.delivery_failure_rate);
    const highValueOrder = Number(product.price || 0) >= 10000 ? 100 : 20;
    const abnormalBehavior =
      normalizeCount(session.repeated_try_requests, 6) > 60 || normalizeCount(session.product_views, 25) > 75
        ? 80
        : 20;

    const score = Math.round(
      returnRate * 0.30 +
        cancellations * 0.15 +
        deviceRisk * 0.20 +
        locationRisk * 0.15 +
        highValueOrder * 0.10 +
        abnormalBehavior * 0.10,
    );

    const riskScore = Math.max(0, Math.min(100, score));
    const riskLevel = getRiskLevel(riskScore);
    const recommendation = getRecommendation(riskScore);
    const reasons = [];

    if (returnRate >= 35) reasons.push('High return history');
    if (cancellations >= 50) reasons.push('Frequent cancellations');
    if (deviceRisk >= 70) reasons.push('Suspicious device activity');
    if (locationRisk >= 50) reasons.push('High-risk delivery zone');
    if (highValueOrder >= 100) reasons.push('High-value product');
    if (abnormalBehavior >= 70) reasons.push('Abnormal session behavior');
    if (reasons.length === 0) reasons.push('Stable profile');

    return res.status(200).json({
      success: true,
      data: {
        risk_score: riskScore,
        risk_level: riskLevel,
        reasons,
        recommendation,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  scoreTrialRisk,
};

