const RiderSettlement = require('../models/RiderSettlement');
const RiderEarnings = require('../models/RiderEarnings');

async function generateWeeklySettlement(riderId) {
  const now = new Date();
  // Simplified weekly boundary: Monday to Sunday
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(endOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  // Check if settlement already exists for this period
  let settlement = await RiderSettlement.findOne({
    riderId,
    settlementPeriodStart: startOfWeek
  });

  if (!settlement) {
    settlement = new RiderSettlement({
      riderId,
      settlementPeriodStart: startOfWeek,
      settlementPeriodEnd: endOfWeek,
      status: 'pending'
    });
  }

  // Find all pending earnings
  const pendingEarnings = await RiderEarnings.find({
    riderId,
    status: 'pending',
    createdAt: { $lte: endOfWeek }
  });

  let gross = 0;
  for (const e of pendingEarnings) {
    gross += e.amount;
    // Mark earning as linked to this settlement
    e.settlementId = settlement._id.toString();
    // Leave status as pending until settlement is paid, or mark as processing.
    e.status = 'approved'; 
    await e.save();
  }

  settlement.grossEarnings += gross;
  settlement.netPayout = settlement.grossEarnings + settlement.adjustments + settlement.bonuses - settlement.deductions;
  
  await settlement.save();
  return settlement;
}

async function getPayoutHistory(riderId) {
  return await RiderSettlement.find({ riderId }).sort({ settlementPeriodStart: -1 }).lean();
}

async function getUpcomingPayout(riderId) {
  return await RiderSettlement.findOne({ riderId, status: { $in: ['pending', 'processing'] } }).sort({ settlementPeriodStart: -1 }).lean();
}

module.exports = {
  generateWeeklySettlement,
  getPayoutHistory,
  getUpcomingPayout
};
