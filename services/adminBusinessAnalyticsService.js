const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');
const Store = require('../models/Store');
const User = require('../models/User');

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatPercent(value) {
  return `${Math.round(value * 10) / 10}%`;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildDailySeries(orders, daysBack = 7) {
  const buckets = new Map();
  const today = startOfDay(new Date());

  for (let i = daysBack - 1; i >= 0; i -= 1) {
    const day = new Date(today.getTime() - i * DAY_MS);
    const key = day.toISOString().slice(0, 10);
    buckets.set(key, { date: key, revenue: 0, orders: 0 });
  }

  for (const order of orders) {
    const key = new Date(order.createdAt).toISOString().slice(0, 10);
    if (!buckets.has(key)) continue;
    const bucket = buckets.get(key);
    bucket.revenue += toNumber(order.finalAmount);
    bucket.orders += 1;
  }

  return Array.from(buckets.values());
}

function calculateGrowth(currentTotal, previousTotal) {
  if (previousTotal === 0) {
    return currentTotal > 0 ? 100 : 0;
  }
  return ((currentTotal - previousTotal) / previousTotal) * 100;
}

class AdminBusinessAnalyticsService {
  async getOverviewMetrics() {
    const today = startOfDay(new Date());
    const sevenDaysAgo = new Date(today.getTime() - 6 * DAY_MS);
    const previousSevenDaysAgo = new Date(today.getTime() - 13 * DAY_MS);

    const [
      totalOrders,
      todayOrders,
      totalRevenueData,
      totalTrials,
      totalVendors,
      totalRiders,
      totalUsers,
      recentOrders,
      previousOrders,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$finalAmount' } } }]),
      TrialHomeSession.countDocuments(),
      Store.countDocuments({ approvalStatus: 'approved' }),
      User.countDocuments({ role: 'rider' }),
      User.countDocuments({ role: 'user' }),
      Order.find({ createdAt: { $gte: sevenDaysAgo } }).select('finalAmount createdAt').lean(),
      Order.find({
        createdAt: { $gte: previousSevenDaysAgo, $lt: sevenDaysAgo },
      }).select('finalAmount createdAt').lean(),
    ]);

    const totalRevenue = totalRevenueData[0]?.total || 0;
    const recentRevenue = recentOrders.reduce((sum, order) => sum + toNumber(order.finalAmount), 0);
    const previousRevenue = previousOrders.reduce((sum, order) => sum + toNumber(order.finalAmount), 0);
    const revenueGrowth = formatPercent(calculateGrowth(recentRevenue, previousRevenue));

    return {
      totalOrders,
      todayOrders,
      totalRevenue,
      totalTrials,
      activeVendors: totalVendors,
      activeRiders: totalRiders,
      totalUsers,
      revenueGrowth,
    };
  }

  async getRevenueTrends() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const orders = await Order.find({
      createdAt: { $gte: sevenDaysAgo },
    }).select('finalAmount createdAt').lean();

    return buildDailySeries(orders, 7);
  }

  async getGeographicDistribution() {
    const stores = await Store.find()
      .select('city')
      .lean();

    const counts = new Map();
    let total = 0;
    for (const store of stores) {
      const city = String(store.city || 'Unknown').trim() || 'Unknown';
      counts.set(city, (counts.get(city) || 0) + 1);
      total += 1;
    }

    const distribution = Array.from(counts.entries())
      .map(([city, count]) => ({
        city,
        percentage: total ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage);

    if (!distribution.length) {
      return [];
    }

    return distribution.slice(0, 5);
  }

  async getTopVendors() {
    const topVendorsData = await Order.aggregate([
      { $group: { _id: '$storeId', totalRevenue: { $sum: '$finalAmount' }, orderCount: { $sum: 1 } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 },
    ]);

    const topVendors = [];
    for (const v of topVendorsData) {
      const store = await Store.findOne({ storeId: v._id }).select('storeName').lean();
      if (store) {
        topVendors.push({
          storeId: v._id,
          storeName: store.storeName,
          totalRevenue: v.totalRevenue,
          orderCount: v.orderCount,
        });
      }
    }
    return topVendors;
  }
}

module.exports = new AdminBusinessAnalyticsService();
