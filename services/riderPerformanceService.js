const RiderPerformanceSnapshot = require('../models/RiderPerformanceSnapshot');
const TrialHomeSession = require('../models/TrialHomeSession');

async function calculateAndSavePerformance(riderId) {
  // Aggregate Trial Stats
  const trials = await TrialHomeSession.find({ riderId }).lean();
  
  let totalTrials = 0;
  let completedTrials = 0;
  let noShows = 0;
  let convertedTrials = 0;
  let totalTrialDurationMins = 0;
  
  for (const t of trials) {
    if (['completed', 'no_show', 'cancelled'].includes(t.status)) {
      totalTrials++;
      if (t.status === 'completed') completedTrials++;
      if (t.status === 'no_show') noShows++;
      if (t.converted) convertedTrials++;
      
      if (t.startedAt && t.completedAt) {
        const diffMins = (new Date(t.completedAt) - new Date(t.startedAt)) / 60000;
        if (diffMins > 0) totalTrialDurationMins += diffMins;
      }
    }
  }

  // Calculate Metrics
  const acceptanceRate = 100; // Mocked for simplicity as assignment logic is complex
  const completionRate = totalTrials > 0 ? (completedTrials / totalTrials) * 100 : 100;
  const trialSuccessRate = totalTrials > 0 ? (completedTrials / totalTrials) * 100 : 100;
  const noShowRate = totalTrials > 0 ? (noShows / totalTrials) * 100 : 0;
  const trialConversionRate = completedTrials > 0 ? (convertedTrials / completedTrials) * 100 : 0;
  const averageTrialTime = completedTrials > 0 ? (totalTrialDurationMins / completedTrials) : 0;
  const averageDeliveryTime = 15; // Assume 15 mins for standard deliveries
  const customerRating = 4.8; // Assume 4.8 default if no ratings collection exists yet

  // Deterministic Rider Score (0-100)
  // Base 100
  // -1 for every 1% no show rate
  // -0.5 for every 1% below 95% completion rate
  // +0.1 for every 1% conversion rate
  let score = 100;
  score -= noShowRate;
  if (completionRate < 95) score -= (95 - completionRate) * 0.5;
  score += (trialConversionRate * 0.1);
  
  if (score > 100) score = 100;
  if (score < 0) score = 0;

  // Save Snapshot
  const snapshot = new RiderPerformanceSnapshot({
    riderId,
    riderScore: Math.round(score),
    acceptanceRate: Math.round(acceptanceRate),
    completionRate: Math.round(completionRate),
    averageDeliveryTime: Math.round(averageDeliveryTime),
    averageTrialTime: Math.round(averageTrialTime),
    customerRating,
    trialSuccessRate: Math.round(trialSuccessRate),
    trialConversionRate: Math.round(trialConversionRate),
    noShowRate: Math.round(noShowRate)
  });

  await snapshot.save();
  return snapshot;
}

async function getLatestPerformance(riderId) {
  let snapshot = await RiderPerformanceSnapshot.findOne({ riderId }).sort({ createdAt: -1 });
  if (!snapshot) {
    snapshot = await calculateAndSavePerformance(riderId);
  }
  return snapshot;
}

module.exports = {
  calculateAndSavePerformance,
  getLatestPerformance,
};
