const mongoose = require('mongoose');

const fitProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GarmentTemplate',
      default: null,
      index: true,
    },
    measurements: {
      type: Map,
      of: Number,
      default: {},
    },
    recommendedSize: {
      type: String,
      trim: true,
      default: 'M',
    },
    fitScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 75,
    },
    fitLabel: {
      type: String,
      trim: true,
      default: 'Good fit',
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0.7,
    },
    source: {
      type: String,
      enum: ['live_tryon', 'manual', 'auto'],
      default: 'live_tryon',
    },
  },
  { timestamps: true }
);

fitProfileSchema.index({ userId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('FitProfile', fitProfileSchema);
