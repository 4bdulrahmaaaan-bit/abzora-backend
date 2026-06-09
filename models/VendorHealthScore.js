const mongoose = require('mongoose');

const vendorHealthScoreSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    businessScore: {
      type: Number,
      default: 0,
    },
    storeHealth: {
      type: Number,
      default: 0,
    },
    inventoryHealth: {
      type: Number,
      default: 0,
    },
    fulfillmentHealth: {
      type: Number,
      default: 0,
    },
    reviewHealth: {
      type: Number,
      default: 0,
    },
    returnHealth: {
      type: Number,
      default: 0,
    },
    revenueHealth: {
      type: Number,
      default: 0,
    },
    recommendations: {
      type: [String],
      default: () => [],
    },
    calculatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    collection: 'vendor_health_scores',
  }
);

module.exports = mongoose.model('VendorHealthScore', vendorHealthScoreSchema);
