const riderEarningsService = require('../services/riderEarningsService');
const riderPerformanceService = require('../services/riderPerformanceService');
const riderSettlementService = require('../services/riderSettlementService');
const riderAnalyticsService = require('../services/riderAnalyticsService');
const RiderIncentive = require('../models/RiderIncentive');

// Earnings
async function getEarnings(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const earnings = await require('../models/RiderEarnings').find({ riderId }).sort({ createdAt: -1 }).limit(50).lean();
    return res.status(200).json({ success: true, data: earnings });
  } catch (error) {
    next(error);
  }
}

async function getEarningsSummary(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const summary = await riderEarningsService.getEarningsSummary(riderId);
    return res.status(200).json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

// Performance
async function getPerformance(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const snapshot = await riderPerformanceService.getLatestPerformance(riderId);
    return res.status(200).json({ success: true, data: snapshot });
  } catch (error) {
    next(error);
  }
}

async function getIncentives(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const incentives = await RiderIncentive.find({ riderId, status: 'active' }).lean();
    return res.status(200).json({ success: true, data: incentives });
  } catch (error) {
    next(error);
  }
}

// Settlements
async function getPayouts(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const upcoming = await riderSettlementService.getUpcomingPayout(riderId);
    return res.status(200).json({ success: true, data: upcoming });
  } catch (error) {
    next(error);
  }
}

async function getPayoutHistory(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const history = await riderSettlementService.getPayoutHistory(riderId);
    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
}

// Analytics
async function getAnalytics(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const analytics = await riderAnalyticsService.getDailyAnalytics(riderId);
    return res.status(200).json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getEarnings,
  getEarningsSummary,
  getPerformance,
  getIncentives,
  getPayouts,
  getPayoutHistory,
  getAnalytics
};
