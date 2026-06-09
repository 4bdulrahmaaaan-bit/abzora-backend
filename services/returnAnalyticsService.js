const ReturnRequest = require('../models/ReturnRequest');
const ExchangeRequest = require('../models/ExchangeRequest');
const RefundRequest = require('../models/RefundRequest');
const Order = require('../models/Order');

class ReturnAnalyticsService {
  async getAnalytics(vendorId, startDate, endDate) {
    const matchStage = { vendorId };
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const [returnStats, exchangeCount, refundCount, orderCount] = await Promise.all([
      ReturnRequest.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalReturns: { $sum: 1 },
            trialReturns: { $sum: { $cond: [{ $eq: ['$isTrialOrder', true] }, 1, 0] } },
            damagedReturns: { $sum: { $cond: [{ $eq: ['$trialOutcome', 'damaged'] }, 1, 0] } },
            avgTrialDaysUsed: { $avg: '$trialDaysUsed' },
          },
        },
      ]),
      ExchangeRequest.countDocuments(matchStage),
      RefundRequest.countDocuments(matchStage),
      Order.countDocuments(matchStage),
    ]);

    const stats = returnStats[0] || {
      totalReturns: 0,
      trialReturns: 0,
      damagedReturns: 0,
      avgTrialDaysUsed: 0,
    };

    const topReasons = await ReturnRequest.aggregate([
      { $match: matchStage },
      { $group: { _id: '$reason', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    const mostReturnedProducts = await ReturnRequest.aggregate([
      { $match: matchStage },
      { $group: { _id: '$productId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    // Trend by month
    const returnTrend = await ReturnRequest.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const totalOrders = orderCount || 1; // prevent div by zero

    return {
      returnRate: (stats.totalReturns / totalOrders) * 100,
      exchangeRate: (exchangeCount / totalOrders) * 100,
      refundRate: (refundCount / totalOrders) * 100,
      topReturnReasons: topReasons,
      mostReturnedProducts,
      returnTrend,
      tbyb: {
        trialReturnRate: stats.trialReturns ? (stats.trialReturns / totalOrders) * 100 : 0, // Simplified relative to all orders, or could be relative to trial orders
        trialDamageRate: stats.trialReturns ? (stats.damagedReturns / stats.trialReturns) * 100 : 0,
        avgTrialDaysUsed: stats.avgTrialDaysUsed || 0,
        trialReturnsCount: stats.trialReturns,
      },
    };
  }
}

module.exports = new ReturnAnalyticsService();
