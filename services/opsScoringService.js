const { ALERT_SEVERITY } = require('./opsConstants');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value, 0))));
}

function computeAlertScore({
  timeDelay = 0,
  etaRisk = 0,
  slaImpact = 0,
  orderValue = 0,
  userPriority = 0,
}) {
  const weightedOrderValue = Math.min(20, Math.round(toNumber(orderValue, 0) / 250));
  const raw =
    toNumber(timeDelay, 0) +
    toNumber(etaRisk, 0) +
    toNumber(slaImpact, 0) +
    weightedOrderValue +
    toNumber(userPriority, 0);
  return clampScore(raw);
}

function scoreToSeverity(score) {
  const normalized = clampScore(score);
  if (normalized >= 80) return ALERT_SEVERITY.CRITICAL;
  if (normalized >= 50) return ALERT_SEVERITY.HIGH;
  if (normalized >= 30) return ALERT_SEVERITY.MEDIUM;
  return ALERT_SEVERITY.LOW;
}

module.exports = {
  computeAlertScore,
  scoreToSeverity,
  clampScore,
};
