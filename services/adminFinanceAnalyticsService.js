const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');
const Settlement = require('../models/Settlement');
const RefundRequest = require('../models/RefundRequest');

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatPercent(value) {
  return `${Math.round(value * 10) / 10}%`;
}

function calculateGrowth(currentTotal, previousTotal) {
  if (previousTotal === 0) {
    return currentTotal > 0 ? 100 : 0;
  }
  return ((currentTotal - previousTotal) / previousTotal) * 100;
}

function buildDailyFinanceSeries(orders, settlements, refunds, daysBack = 7) {
  const buckets = new Map();
  const today = startOfDay(new Date());

  for (let i = daysBack - 1; i >= 0; i -= 1) {
    const day = new Date(today.getTime() - i * DAY_MS);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      revenue: 0,
      commission: 0,
      settlements: 0,
      refunds: 0,
    });
  }

  for (const order of orders) {
    const key = new Date(order.createdAt).toISOString().slice(0, 10);
    if (!buckets.has(key)) continue;
    buckets.get(key).revenue += toNumber(order.finalAmount);
    buckets.get(key).commission += toNumber(order.platformCommission);
  }

  for (const settlement of settlements) {
    const key = new Date(settlement.createdAt).toISOString().slice(0, 10);
    if (!buckets.has(key)) continue;
    buckets.get(key).settlements += toNumber(settlement.netAmount);
  }

  for (const refund of refunds) {
    const key = new Date(refund.createdAt).toISOString().slice(0, 10);
    if (!buckets.has(key)) continue;
    buckets.get(key).refunds += toNumber(refund.amount);
  }

  return Array.from(buckets.values());
}

class AdminFinanceAnalyticsService {
  async getDashboardKPIs() {
    const today = startOfDay(new Date());
    const sevenDaysAgo = new Date(today.getTime() - 6 * DAY_MS);
    const previousSevenDaysAgo = new Date(today.getTime() - 13 * DAY_MS);

    const [
      orders,
      settlements,
      refunds,
      trialSessions,
    ] = await Promise.all([
      Order.find({ createdAt: { $gte: previousSevenDaysAgo } })
        .select('finalAmount platformCommission createdAt paymentStatus refundStatus')
        .lean(),
      Settlement.find({ createdAt: { $gte: previousSevenDaysAgo } })
        .select('grossAmount platformFees taxes netAmount status createdAt')
        .lean(),
      RefundRequest.find({ createdAt: { $gte: previousSevenDaysAgo } })
        .select('amount status createdAt')
        .lean(),
      TrialHomeSession.find({ createdAt: { $gte: previousSevenDaysAgo } })
        .select('finalAmount createdAt')
        .lean(),
    ]);

    const allOrdersRevenue = orders.reduce((sum, order) => sum + toNumber(order.finalAmount), 0);
    const platformCommission = orders.reduce((sum, order) => sum + toNumber(order.platformCommission), 0);
    const trialRevenue = trialSessions.reduce((sum, session) => sum + toNumber(session.finalAmount), 0);
    const refundExposure = refunds
      .filter((refund) => ['requested', 'pending', 'approved', 'processing'].includes(String(refund.status).toLowerCase()))
      .reduce((sum, refund) => sum + toNumber(refund.amount), 0);

    const pendingSettlements = settlements.filter((settlement) => String(settlement.status).toLowerCase() === 'pending');
    const paidSettlements = settlements.filter((settlement) => String(settlement.status).toLowerCase() === 'paid');

    const pendingSettlementsValue = pendingSettlements.reduce((sum, settlement) => sum + toNumber(settlement.netAmount), 0);
    const totalSettlementsCount = pendingSettlements.length + paidSettlements.length;
    const settlementSuccessRate = totalSettlementsCount > 0
      ? (paidSettlements.length / totalSettlementsCount) * 100
      : 100;

    const recentOrderRevenue = orders
      .filter((order) => new Date(order.createdAt).getTime() >= sevenDaysAgo.getTime())
      .reduce((sum, order) => sum + toNumber(order.finalAmount), 0);
    const previousOrderRevenue = orders
      .filter((order) => new Date(order.createdAt).getTime() < sevenDaysAgo.getTime())
      .reduce((sum, order) => sum + toNumber(order.finalAmount), 0);

    const recentCommission = orders
      .filter((order) => new Date(order.createdAt).getTime() >= sevenDaysAgo.getTime())
      .reduce((sum, order) => sum + toNumber(order.platformCommission), 0);
    const previousCommission = orders
      .filter((order) => new Date(order.createdAt).getTime() < sevenDaysAgo.getTime())
      .reduce((sum, order) => sum + toNumber(order.platformCommission), 0);

    const recentRefunds = refunds
      .filter((refund) => new Date(refund.createdAt).getTime() >= sevenDaysAgo.getTime())
      .reduce((sum, refund) => sum + toNumber(refund.amount), 0);
    const recentRevenue = recentOrderRevenue || allOrdersRevenue;
    const previousRevenue = previousOrderRevenue;
    const revenueGrowthPercent = formatPercent(calculateGrowth(recentRevenue, previousRevenue));
    const commissionGrowthPercent = formatPercent(calculateGrowth(recentCommission, previousCommission));
    const refundRatio = formatPercent(
      recentRevenue > 0 ? (recentRefunds / recentRevenue) * 100 : 0,
    );

    return {
      gmv: allOrdersRevenue,
      netRevenue: Math.max(0, allOrdersRevenue - refundExposure),
      platformCommission,
      trialRevenue,
      refundExposure,
      pendingSettlementsValue,
      pendingSettlementsCount: pendingSettlements.length,
      completedSettlementsCount: paidSettlements.length,
      settlementSuccessRate,
      financeHealthScore: settlementSuccessRate > 90 ? 'Healthy' : settlementSuccessRate > 70 ? 'Warning' : 'Critical',
      revenueGrowthPercent,
      commissionGrowthPercent,
      refundRatio,
    };
  }

  async getReports(period = 'Daily') {
    const days = period === 'Weekly' ? 28 : period === 'Monthly' ? 90 : 7;
    const since = new Date();
    since.setDate(since.getDate() - (days - 1));

    const [orders, settlements, refunds] = await Promise.all([
      Order.find({ createdAt: { $gte: since } }).select('finalAmount platformCommission createdAt').lean(),
      Settlement.find({ createdAt: { $gte: since } }).select('netAmount createdAt').lean(),
      RefundRequest.find({ createdAt: { $gte: since } }).select('amount createdAt').lean(),
    ]);

    return buildDailyFinanceSeries(orders, settlements, refunds, days);
  }
}

module.exports = new AdminFinanceAnalyticsService();
