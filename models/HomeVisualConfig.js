const mongoose = require('mongoose');

const categoryVisualSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    tab: {
      type: String,
      enum: ['All', 'Men', 'Women', 'Kids'],
      default: 'All',
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      default: 'category',
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const promoBlockSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    slot: {
      type: Number,
      default: 1,
    },
    eyebrow: {
      type: String,
      default: '',
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      default: '',
      trim: true,
    },
    ctaText: {
      type: String,
      default: 'Explore',
      trim: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    redirectType: {
      type: String,
      enum: ['product', 'store', 'category', 'custom'],
      default: 'category',
      trim: true,
    },
    redirectId: {
      type: String,
      default: '',
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const featuredStoreBlockSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      trim: true,
    },
    storeId: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: '',
      trim: true,
    },
    label: {
      type: String,
      default: '',
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const homeVisualConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'home-visual-config',
      trim: true,
    },
    categoryVisuals: {
      type: [categoryVisualSchema],
      default: [],
    },
    promoBlocks: {
      type: [promoBlockSchema],
      default: [],
    },
    featuredStoreBlocks: {
      type: [featuredStoreBlockSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HomeVisualConfig', homeVisualConfigSchema);
