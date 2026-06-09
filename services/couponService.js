const Coupon = require('../models/Coupon');

class CouponService {
  async createCoupon(data) {
    const existing = await Coupon.findOne({ couponCode: data.couponCode });
    if (existing) throw new Error('Coupon code already exists');
    
    const coupon = new Coupon(data);
    await coupon.save();
    return coupon;
  }

  async getCoupons(vendorId) {
    return Coupon.find({ vendorId }).sort({ createdAt: -1 });
  }

  async updateCoupon(id, vendorId, data) {
    const coupon = await Coupon.findOneAndUpdate({ _id: id, vendorId }, data, { new: true });
    if (!coupon) throw new Error('Coupon not found');
    return coupon;
  }

  async updateStatus(id, vendorId, status) {
    const coupon = await Coupon.findOneAndUpdate({ _id: id, vendorId }, { status }, { new: true });
    if (!coupon) throw new Error('Coupon not found');
    return coupon;
  }

  async deleteCoupon(id, vendorId) {
    const result = await Coupon.deleteOne({ _id: id, vendorId });
    if (result.deletedCount === 0) throw new Error('Coupon not found');
    return { success: true };
  }
}

module.exports = new CouponService();
