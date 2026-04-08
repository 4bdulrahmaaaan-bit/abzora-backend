const mongoose = require('mongoose');

const rangeSchema = new mongoose.Schema(
  {
    min: {
      type: Number,
      default: 0,
    },
    max: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const interactionCountsSchema = new mongoose.Schema(
  {
    clicks: {
      type: Number,
      default: 0,
    },
    carts: {
      type: Number,
      default: 0,
    },
    purchases: {
      type: Number,
      default: 0,
    },
    wishlists: {
      type: Number,
      default: 0,
    },
    skips: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const userStyleProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    gender: {
      type: String,
      trim: true,
      default: '',
    },
    preferredCategories: {
      type: [String],
      default: [],
    },
    priceRange: {
      type: rangeSchema,
      default: () => ({}),
    },
    colorPreference: {
      type: [String],
      default: [],
    },
    bodyType: {
      type: String,
      trim: true,
      default: '',
    },
    bodyShape: {
      type: String,
      trim: true,
      default: '',
    },
    size: {
      type: String,
      trim: true,
      default: '',
    },
    pastPurchases: {
      type: [String],
      default: [],
    },
    wishlist: {
      type: [String],
      default: [],
    },
    browsingHistory: {
      type: [String],
      default: [],
    },
    categoryAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    colorAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    occasionAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    styleAffinity: {
      type: Map,
      of: Number,
      default: {},
    },
    interactionCounts: {
      type: interactionCountsSchema,
      default: () => ({}),
    },
    updatedAtIso: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('UserStyleProfile', userStyleProfileSchema);
