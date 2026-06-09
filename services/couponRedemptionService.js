const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const AnalyticsEvent = require('../models/AnalyticsEvent');

class CouponRedemptionService {
  async validateCoupon(couponCode, vendorId, orderValue) {
    const coupon = await Coupon.findOne({ couponCode, vendorId });
    if (!coupon) throw new Error('Invalid coupon code');

    if (coupon.status !== 'active') throw new Error('Coupon is not active');
    
    const now = new Date();
    if (now < coupon.startDate || now > coupon.endDate) throw new Error('Coupon is expired');

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) throw new Error('Coupon usage limit reached');

    if (coupon.minimumOrderValue && orderValue < coupon.minimumOrderValue) {
      throw new Error(`Minimum order value of ${coupon.minimumOrderValue} required`);
    }

    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = coupon.discountValue;
    } else if (coupon.discountType === 'percentage') {
      discountAmount = orderValue * (coupon.discountValue / 100);
    }

    if (coupon.maximumDiscount && discountAmount > coupon.maximumDiscount) {
      discountAmount = coupon.maximumDiscount;
    }

    discountAmount = Math.min(discountAmount, orderValue);

    return { coupon, discountAmount };
  }

  async redeemCoupon(couponCode, vendorId, customerId, orderId, orderValue, sessionData = {}) {
    const { coupon, discountAmount } = await this.validateCoupon(couponCode, vendorId, orderValue);

    const redemption = new CouponRedemption({
      couponId: coupon._id,
      couponCode: coupon.couponCode,
      vendorId,
      customerId,
      orderId,
      discountAmount
    });
    await redemption.save();

    await Coupon.updateOne({ _id: coupon._id }, { $inc: { usedCount: 1 } });

    const analyticsEvent = new AnalyticsEvent({
      eventType: 'coupon_apply',
      vendorId,
      customerId,
      sessionId: sessionData.sessionId || '',
      isTrialOrder: sessionData.isTrialOrder || false,
      trialSessionId: sessionData.trialSessionId || '',
      metadata: { couponCode, orderId, discountAmount }
    });
    await analyticsEvent.save();

    return { redemption, discountAmount };
  }
}

module.exports = new CouponRedemptionService();
