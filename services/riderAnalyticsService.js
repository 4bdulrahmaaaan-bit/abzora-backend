const TrialHomeSession = require('../models/TrialHomeSession');
const RiderEarnings = require('../models/RiderEarnings');

async function getDailyAnalytics(riderId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const trials = await TrialHomeSession.find({
    riderId,
    createdAt: { $gte: startOfDay }
  }).lean();

  const earnings = await RiderEarnings.find({
    riderId,
    createdAt: { $gte: startOfDay }
  }).lean();

  let trialsPerDay = trials.length;
  let returnsHandled = 0;
  let exchangesHandled = 0; // Excluded for now unless there's an Exchange collection
  let revenueGenerated = 0;
  let tbybRevenue = 0;
  let deliveriesPerDay = 0; // Count normal deliveries if mixed

  for (const t of trials) {
    if (t.status === 'completed') {
      if (t.finalAmount > 0) tbybRevenue += t.finalAmount;
      if (t.returnObserved) returnsHandled++;
    }
  }

  for (const e of earnings) {
    if (e.status !== 'cancelled') {
      revenueGenerated += e.amount;
      if (e.earningType === 'delivery') deliveriesPerDay++;
    }
  }

  return {
    deliveriesPerDay,
    trialsPerDay,
    returnsHandled,
    exchangesHandled,
    revenueGenerated,
    tbybRevenue,
    peakWorkingHours: '12:00 PM - 3:00 PM' // Placeholder for actual peak calc
  };
}

module.exports = {
  getDailyAnalytics
};
