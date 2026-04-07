const mongoose = require('mongoose');

const growthOfferSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      trim: true,
      default: 'discount',
    },
    title: {
      type: String,
      trim: true,
      default: '',
    },
    subtitle: {
      type: String,
      trim: true,
      default: '',
    },
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    discountPercent: {
      type: Number,
      default: 0,
    },
    discountAmount: {
      type: Number,
      default: 0,
    },
    minOrderValue: {
      type: Number,
      default: 0,
    },
    autoApply: {
      type: Boolean,
      default: false,
    },
    isClaimed: {
      type: Boolean,
      default: false,
    },
    createdAtIso: {
      type: String,
      trim: true,
      default: '',
    },
    expiresAt: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

growthOfferSchema.index({ userId: 1, code: 1 }, { unique: true });

module.exports = mongoose.model('GrowthOffer', growthOfferSchema);
