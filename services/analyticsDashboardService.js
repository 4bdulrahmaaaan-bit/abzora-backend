const AnalyticsEvent = require('../models/AnalyticsEvent');
const ExperienceLog = require('../models/ExperienceLog');
const MLBanditState = require('../models/MLBanditState');
const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');

function toDateRange(from, to) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const end = to ? new Date(to) : now;
  return { start, end };
}

async function getOverviewMetrics(range) {
  const [views, purchases, ctaClicks, trialRequests, trialConversions] = await Promise.all([
    AnalyticsEvent.countDocuments({ eventType: 'product_view', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'purchase', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'cta_click', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'trial_request', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'trial_conversion', timestamp: range }),
  ]);

  const orderStats = await Order.aggregate([
    { $match: { createdAt: range } },
    {
      $group: {
        _id: null,
        revenue: { $sum: '$totalAmount' },
        avgOrderValue: { $avg: '$totalAmount' },
        orders: { $sum: 1 },
        returns: {
          $sum: {
            $cond: [{ $ne: ['$returnStatus', 'none'] }, 1, 0],
          },
        },
      },
    },
  ]);
  const summary = orderStats[0] || { revenue: 0, avgOrderValue: 0, orders: 0, returns: 0 };

  return {
    revenue: Number(summary.revenue || 0),
    conversion_rate: views > 0 ? purchases / views : 0,
    AOV: Number(summary.avgOrderValue || 0),
    return_rate: summary.orders > 0 ? summary.returns / summary.orders : 0,
    CTA_click_rate: views > 0 ? ctaClicks / views : 0,
    trial_usage: views > 0 ? trialRequests / views : 0,
    trial_conversion_rate: trialRequests > 0 ? trialConversions / trialRequests : 0,
  };
}

async function getCtaPerformance(range) {
  return ExperienceLog.aggregate([
    { $match: { decisionAt: range } },
    {
      $group: {
        _id: '$cta',
        shown: { $sum: 1 },
        purchases: { $sum: { $cond: ['$result.purchased', 1, 0] } },
        trialConversions: { $sum: { $cond: ['$result.trialConverted', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        cta: '$_id',
        shown: 1,
        purchases: 1,
        trialConversions: 1,
        conversionRate: {
          $cond: [{ $gt: ['$shown', 0] }, { $divide: ['$purchases', '$shown'] }, 0],
        },
      },
    },
    { $sort: { shown: -1 } },
  ]);
}

async function getUrgencyImpact(range) {
  return ExperienceLog.aggregate([
    { $match: { decisionAt: range } },
    {
      $group: {
        _id: '$urgency',
        shown: { $sum: 1 },
        purchases: { $sum: { $cond: ['$result.purchased', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        urgency: '$_id',
        shown: 1,
        purchases: 1,
        conversionRate: {
          $cond: [{ $gt: ['$shown', 0] }, { $divide: ['$purchases', '$shown'] }, 0],
        },
      },
    },
    { $sort: { shown: -1 } },
  ]);
}

async function getCheckoutFunnel(range) {
  const [productViews, ctaClicks, checkoutStarts, purchases] = await Promise.all([
    AnalyticsEvent.countDocuments({ eventType: 'product_view', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'cta_click', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'checkout_start', timestamp: range }),
    AnalyticsEvent.countDocuments({ eventType: 'purchase', timestamp: range }),
  ]);

  return {
    product_view: productViews,
    cta_click: ctaClicks,
    checkout_start: checkoutStarts,
    purchase: purchases,
    drop_off_after_view: Math.max(productViews - ctaClicks, 0),
    drop_off_after_click: Math.max(ctaClicks - checkoutStarts, 0),
    drop_off_after_checkout: Math.max(checkoutStarts - purchases, 0),
  };
}

async function getTrialPerformance(range) {
  const [sessions, converted, returns] = await Promise.all([
    TrialHomeSession.countDocuments({ createdAt: range }),
    TrialHomeSession.countDocuments({ createdAt: range, converted: true }),
    TrialHomeSession.countDocuments({ createdAt: range, returnObserved: true }),
  ]);

  return {
    sessions,
    converted,
    returns,
    conversion_rate: sessions > 0 ? converted / sessions : 0,
    return_rate: sessions > 0 ? returns / sessions : 0,
  };
}

async function getSameDayPerformance(range) {
  return ExperienceLog.aggregate([
    { $match: { decisionAt: range } },
    {
      $group: {
        _id: '$features.sameDayAvailable',
        decisions: { $sum: 1 },
        purchases: { $sum: { $cond: ['$result.purchased', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        sameDayAvailable: '$_id',
        decisions: 1,
        purchases: 1,
        conversionRate: {
          $cond: [{ $gt: ['$decisions', 0] }, { $divide: ['$purchases', '$decisions'] }, 0],
        },
      },
    },
  ]);
}

async function getSegments(range) {
  return ExperienceLog.aggregate([
    { $match: { decisionAt: range } },
    {
      $group: {
        _id: '$features.userType',
        decisions: { $sum: 1 },
        purchases: { $sum: { $cond: ['$result.purchased', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        userType: { $ifNull: ['$_id', 'unknown'] },
        decisions: 1,
        purchases: 1,
        conversionRate: {
          $cond: [{ $gt: ['$decisions', 0] }, { $divide: ['$purchases', '$decisions'] }, 0],
        },
      },
    },
  ]);
}

async function getMlPanel(range) {
  const [actions, recentDecisions, mlBanditDecisions, ruleDecisions] = await Promise.all([
    MLBanditState.find({}).lean(),
    ExperienceLog.find({ decisionAt: range })
      .sort({ decisionAt: -1 })
      .limit(30)
      .select('decisionId cta source features result decisionAt mlDecision')
      .lean(),
    ExperienceLog.countDocuments({ decisionAt: range, source: 'ML_BANDIT' }),
    ExperienceLog.countDocuments({ decisionAt: range, source: { $in: ['RULE', 'AB_TEST'] } }),
  ]);

  const accuracyPerCTA = await ExperienceLog.aggregate([
    { $match: { decisionAt: range, source: 'ML_BANDIT' } },
    {
      $group: {
        _id: '$cta',
        decisions: { $sum: 1 },
        purchases: { $sum: { $cond: ['$result.purchased', 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        cta: '$_id',
        decisions: 1,
        purchases: 1,
        accuracy: {
          $cond: [{ $gt: ['$decisions', 0] }, { $divide: ['$purchases', '$decisions'] }, 0],
        },
      },
    },
  ]);

  const featureImportance = {};
  for (const state of actions) {
    const weights = state.weights || {};
    for (const [key, value] of Object.entries(weights)) {
      featureImportance[key] = (featureImportance[key] || 0) + Math.abs(Number(value) || 0);
    }
  }

  const explorationEvents = actions.reduce((sum, action) => sum + (action.explorationCount || 0), 0);
  const totalPulls = actions.reduce((sum, action) => sum + (action.pulls || 0), 0);

  return {
    accuracy_per_CTA: accuracyPerCTA,
    feature_importance: featureImportance,
    real_time_decisions: recentDecisions,
    conversion_lift_proxy: {
      ml_decisions: mlBanditDecisions,
      rules_decisions: ruleDecisions,
      relative_share: (mlBanditDecisions + ruleDecisions) > 0
        ? mlBanditDecisions / (mlBanditDecisions + ruleDecisions)
        : 0,
    },
    exploration_percent: totalPulls > 0 ? explorationEvents / totalPulls : 0,
  };
}

async function getDashboard({ from, to }) {
  const { start, end } = toDateRange(from, to);
  const range = { $gte: start, $lte: end };

  const [overview, ctaPerformance, urgencyImpact, checkoutFunnel, trialUsage, sameDayPerformance, userSegments, mlPanel] = await Promise.all([
    getOverviewMetrics(range),
    getCtaPerformance(range),
    getUrgencyImpact(range),
    getCheckoutFunnel(range),
    getTrialPerformance(range),
    getSameDayPerformance(range),
    getSegments(range),
    getMlPanel(range),
  ]);

  return {
    window: { from: start.toISOString(), to: end.toISOString() },
    overview,
    cta_performance: ctaPerformance,
    urgency_impact: urgencyImpact,
    checkout_funnel: checkoutFunnel,
    trial_usage: trialUsage,
    same_day_performance: sameDayPerformance,
    user_segments: userSegments,
    ml_panel: mlPanel,
  };
}

module.exports = {
  getDashboard,
};
