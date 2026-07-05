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
    targetType: {
      type: String,
      enum: [
        'category',
        'collection',
        'brand',
        'campaign',
        'sale_campaign',
        'product_listing',
        'product',
        'single_product',
        'store',
        'custom_deep_link',
      ],
      default: 'category',
      trim: true,
    },
    targetId: {
      type: String,
      trim: true,
      default: '',
    },
    deeplink: {
      type: String,
      trim: true,
      default: '',
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
    redirectType: {
      type: String,
      trim: true,
      default: '',
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
