const mongoose = require('mongoose');

const couponRedemptionSchema = new mongoose.Schema(
  {
    couponId: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    couponCode: { type: String, required: true, trim: true },
    vendorId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    discountAmount: { type: Number, required: true, min: 0 },
    redeemedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CouponRedemption', couponRedemptionSchema);
