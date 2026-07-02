const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const Order = require('../models/Order');

class CouponRedemptionService {
  _normalizeCode(couponCode) {
    return String(couponCode || '').trim().toUpperCase();
  }

  _discountAmountForCoupon(coupon, orderValue) {
    if (!coupon) {
      return 0;
    }
    let discountAmount = 0;
    if (coupon.discountType === 'fixed') {
      discountAmount = Number(coupon.discountValue || 0);
    } else if (coupon.discountType === 'percentage') {
      discountAmount = orderValue * (Number(coupon.discountValue || 0) / 100);
    }
    if (coupon.maximumDiscount && discountAmount > coupon.maximumDiscount) {
      discountAmount = Number(coupon.maximumDiscount);
    }
    return Math.min(discountAmount, orderValue);
  }

  async _customerOrderCount(customerId) {
    if (!customerId) {
      return 0;
    }
    return Order.countDocuments({
      userId: String(customerId).trim(),
      orderStatus: { $ne: 'cancelled' },
    });
  }

  async _evaluateCouponEligibility(coupon, { orderValue = 0, customerId } = {}) {
    if (!coupon) {
      return { eligible: false, reason: 'Invalid coupon code' };
    }

    if (coupon.status !== 'active') {
      return { eligible: false, reason: 'Coupon is not active' };
    }

    const now = new Date();
    if (now < coupon.startDate || now > coupon.endDate) {
      return { eligible: false, reason: 'Coupon is expired' };
    }

    if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
      return { eligible: false, reason: 'Coupon usage limit reached' };
    }

    if (coupon.minimumOrderValue && orderValue < coupon.minimumOrderValue) {
      return {
        eligible: false,
        reason: `Minimum order value of ${coupon.minimumOrderValue} required`,
      };
    }

    const eligibleUserIds = Array.isArray(coupon.eligibleUserIds)
      ? coupon.eligibleUserIds.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (eligibleUserIds.length > 0) {
      const normalizedCustomerId = String(customerId || '').trim();
      if (!normalizedCustomerId || !eligibleUserIds.includes(normalizedCustomerId)) {
        return {
          eligible: false,
          reason: 'This coupon is not available for your account',
        };
      }
    }

    if (coupon.firstOrderOnly && customerId) {
      const orderCount = await this._customerOrderCount(customerId);
      if (orderCount > 0) {
        return {
          eligible: false,
          reason: 'This coupon is valid for first orders only',
        };
      }
    }

    const discountAmount = this._discountAmountForCoupon(coupon, orderValue);
    return { eligible: true, reason: '', discountAmount };
  }

  async _findCoupon(couponCode, vendorId) {
    const normalizedCode = this._normalizeCode(couponCode);
    if (!normalizedCode) {
      return null;
    }

    if (vendorId) {
      const vendorCoupon = await Coupon.findOne({ couponCode: normalizedCode, vendorId });
      if (vendorCoupon) {
        return vendorCoupon;
      }
    }

    return Coupon.findOne({ couponCode: normalizedCode, vendorId: 'ADMIN' });
  }

  async validateCoupon(couponCode, vendorId, orderValue, options = {}) {
    const coupon = await this._findCoupon(couponCode, vendorId);
    const evaluation = await this._evaluateCouponEligibility(coupon, {
      orderValue,
      customerId: options.customerId,
    });
    if (!evaluation.eligible) {
      throw new Error(evaluation.reason);
    }
    return { coupon, discountAmount: evaluation.discountAmount };
  }

  async redeemCoupon(couponCode, vendorId, customerId, orderId, orderValue, sessionData = {}) {
    const { coupon, discountAmount } = await this.validateCoupon(couponCode, vendorId, orderValue, {
      customerId,
    });

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

  async listEligibleCoupons({ customerId, orderValue }) {
    const coupons = await Coupon.find({ vendorId: 'ADMIN' }).sort({ createdAt: -1 });
    const eligible = [];

    for (const coupon of coupons) {
      const evaluation = await this._evaluateCouponEligibility(coupon, {
        orderValue,
        customerId,
      });
      if (evaluation.eligible) {
        eligible.push({
          ...coupon.toObject(),
          discountAmount: evaluation.discountAmount,
        });
      }
    }

    eligible.sort((left, right) => {
      const rightValue = Number(right.discountAmount || 0);
      const leftValue = Number(left.discountAmount || 0);
      if (rightValue !== leftValue) {
        return rightValue - leftValue;
      }
      return new Date(right.createdAt || 0) - new Date(left.createdAt || 0);
    });

    return eligible;
  }
}

module.exports = new CouponRedemptionService();
