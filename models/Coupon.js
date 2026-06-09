const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true, index: true },
    couponCode: { type: String, required: true, uppercase: true, trim: true, index: { unique: true } },
    discountType: { type: String, enum: ['percentage', 'fixed'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    minimumOrderValue: { type: Number, default: 0, min: 0 },
    maximumDiscount: { type: Number, default: null, min: 0 },
    usageLimit: { type: Number, default: null, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['draft', 'active', 'expired', 'disabled'], default: 'draft' },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);
