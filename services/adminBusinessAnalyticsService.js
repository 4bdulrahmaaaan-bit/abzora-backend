const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');
const CouponRedemption = require('../models/CouponRedemption');
const VendorStore = require('../models/VendorStore');
const RiderProfile = require('../models/RiderProfile');
const User = require('../models/User');
const AdminActivityLog = require('../models/AdminActivityLog');

class AdminBusinessAnalyticsService {
  async getOverviewMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOrders,
      todayOrders,
      totalRevenueData,
      totalTrials,
      totalVendors,
      totalRiders,
      totalUsers,
    ] = await Promise.all([
      Order.countDocuments(),
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$finalAmount' } } }]),
      TrialHomeSession.countDocuments(),
      VendorStore.countDocuments(),
      RiderProfile.countDocuments(),
      User.countDocuments({ role: 'user' }),
    ]);

    const totalRevenue = totalRevenueData[0]?.total || 0;

    return {
      totalOrders,
      todayOrders,
      totalRevenue,
      totalTrials,
      activeVendors: totalVendors,
      activeRiders: totalRiders,
      totalUsers,
      revenueGrowth: '14.5%', // Mocked trend
    };
  }

  async getRevenueTrends() {
    // Generate mock past 7 days trends until we implement heavy time-series aggregation
    const trends = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      trends.push({
        date: d.toISOString().split('T')[0],
        revenue: Math.floor(Math.random() * 50000) + 10000,
        orders: Math.floor(Math.random() * 100) + 20,
      });
    }
    return trends;
  }

  async getGeographicDistribution() {
    // Group users/orders by city (Mocked for now)
    return [
      { city: 'Mumbai', percentage: 35 },
      { city: 'Delhi', percentage: 25 },
      { city: 'Bangalore', percentage: 20 },
      { city: 'Hyderabad', percentage: 10 },
      { city: 'Others', percentage: 10 },
    ];
  }

  async getTopVendors() {
    const topVendorsData = await Order.aggregate([
      { $group: { _id: '$storeId', totalRevenue: { $sum: '$finalAmount' }, orderCount: { $sum: 1 } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 }
    ]);

    const topVendors = [];
    for (const v of topVendorsData) {
      const store = await VendorStore.findOne({ storeId: v._id }).select('storeName').lean();
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
