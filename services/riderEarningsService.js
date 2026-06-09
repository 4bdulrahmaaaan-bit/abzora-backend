const RiderEarnings = require('../models/RiderEarnings');

async function logEarnings({ riderId, earningType, amount, orderId, trialSessionId, notes, status = 'pending' }) {
  const earning = new RiderEarnings({
    riderId,
    earningType,
    amount,
    orderId,
    trialSessionId,
    notes,
    status
  });
  await earning.save();
  return earning;
}

async function getEarningsSummary(riderId) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const earnings = await RiderEarnings.find({ riderId }).lean();

  let today = 0, weekly = 0, monthly = 0, pending = 0, paid = 0, tbyb = 0;

  for (const e of earnings) {
    if (e.status === 'cancelled') continue;

    const createdAt = new Date(e.createdAt);
    if (createdAt >= startOfDay) today += e.amount;
    if (createdAt >= startOfWeek) weekly += e.amount;
    if (createdAt >= startOfMonth) monthly += e.amount;

    if (e.status === 'pending') pending += e.amount;
    if (e.status === 'paid') paid += e.amount;

    if (['trial_delivery', 'trial_completion', 'trial_conversion_bonus'].includes(e.earningType)) {
      tbyb += e.amount;
    }
  }

  return {
    today,
    weekly,
    monthly,
    pending,
    paid,
    tbyb
  };
}

module.exports = {
  logEarnings,
  getEarningsSummary,
};
