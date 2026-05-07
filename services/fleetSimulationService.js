function simulateDispatchScenario(input = {}) {
  const demand = String(input.demand || 'normal');
  const weather = String(input.weather || 'clear');
  const riderOutagePercent = Number(input.riderOutagePercent || 0);

  const demandFactor = demand === 'high' ? 1.25 : demand === 'surge' ? 1.5 : 1;
  const weatherPenalty = weather === 'rain' ? 1.15 : weather === 'storm' ? 1.35 : 1;
  const outagePenalty = 1 + (Math.max(0, riderOutagePercent) / 100);

  const avgEta = Number((24 * demandFactor * weatherPenalty * outagePenalty).toFixed(1));
  const utilization = Math.min(99, Math.round(62 * demandFactor * outagePenalty));
  const delayPercent = Math.min(95, Number((8 * demandFactor * weatherPenalty * outagePenalty).toFixed(1)));
  const successRate = Math.max(5, Number((100 - delayPercent * 0.8).toFixed(1)));

  return {
    input: { demand, weather, riderOutagePercent },
    output: {
      avgEta,
      utilization,
      delayPercent,
      successRate,
      recommendation: utilization > 85 ? 'Add riders to surge zones and enable batching.' : 'Fleet stable for current load.',
    },
  };
}

module.exports = {
  simulateDispatchScenario,
};
