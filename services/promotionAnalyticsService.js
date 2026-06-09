const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const Campaign = require('../models/Campaign');

class PromotionAnalyticsService {
  async getAnalytics(vendorId) {
    const [couponAgg, topCoupons, topCampaigns] = await Promise.all([
      CouponRedemption.aggregate([
        { $match: { vendorId } },
        {
          $group: {
            _id: null,
            couponUsage: { $sum: 1 },
            discountGiven: { $sum: '$discountAmount' },
          }
        }
      ]),
      Coupon.find({ vendorId }).sort({ usedCount: -1 }).limit(5),
      Campaign.find({ vendorId }).sort({ createdAt: -1 }).limit(5)
    ]);

    const revenueAgg = await CouponRedemption.aggregate([
      { $match: { vendorId } },
      {
        $lookup: {
          from: 'orders',
          localField: 'orderId',
          foreignField: '_id',
          as: 'order'
        }
      },
      { $unwind: '$order' },
      {
        $group: {
          _id: null,
          revenueGenerated: { $sum: '$order.totalAmount' }
        }
      }
    ]);

    const usageStats = couponAgg[0] || { couponUsage: 0, discountGiven: 0 };
    const revenueStats = revenueAgg[0] || { revenueGenerated: 0 };

    return {
      couponUsage: usageStats.couponUsage,
      revenueGenerated: revenueStats.revenueGenerated,
      discountGiven: usageStats.discountGiven,
      topCoupons,
      topCampaigns
    };
  }
}

module.exports = new PromotionAnalyticsService();
