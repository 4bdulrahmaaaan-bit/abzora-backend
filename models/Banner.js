const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema(
  {
    imageUrl: {
      type: String,
      required: true,
      trim: true,
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
    ctaText: {
      type: String,
      trim: true,
      default: 'Shop Now',
    },
    redirectType: {
      type: String,
      enum: ['product', 'store', 'category'],
      default: 'store',
      trim: true,
    },
    redirectId: {
      type: String,
      trim: true,
      default: '',
    },
    order: {
      type: Number,
      default: 0,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Banner', bannerSchema);
