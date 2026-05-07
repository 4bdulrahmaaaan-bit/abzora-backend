function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeRiderPerformance(input = {}) {
  const deliverySpeed = Number(input.deliverySpeed || 0);
  const acceptanceRate = Number(input.acceptanceRate || 0);
  const cancellationRate = Number(input.cancellationRate || 0);
  const attendance = Number(input.attendance || 0);
  const reviews = Number(input.reviews || 0);
  const fraudSignals = Number(input.fraudSignals || 0);
  const routeEfficiency = Number(input.routeEfficiency || 0);

  let score = 0;
  score += clamp((30 - deliverySpeed) * 2, 0, 25);
  score += clamp(acceptanceRate * 0.25, 0, 25);
  score += clamp((100 - cancellationRate) * 0.15, 0, 15);
  score += clamp(attendance * 0.15, 0, 15);
  score += clamp(reviews * 4, 0, 10);
  score += clamp(routeEfficiency * 0.1, 0, 10);
  score -= clamp(fraudSignals * 6, 0, 18);

  score = clamp(Math.round(score), 0, 100);
  const tier = score >= 80 ? 'green' : score >= 55 ? 'yellow' : 'red';
  return { score, tier };
}

function dispatchScore(input = {}) {
  const distance = Number(input.distance || 0);
  const activeOrders = Number(input.activeOrders || 0);
  const rating = Number(input.rating || 0);
  const batchEfficiency = Number(input.batchEfficiency || 0);
  return (distance * 0.4) + (activeOrders * 0.3) - (rating * 0.2) - (batchEfficiency * 0.1);
}

module.exports = {
  computeRiderPerformance,
  dispatchScore,
};
