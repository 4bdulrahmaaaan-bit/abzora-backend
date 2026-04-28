const mongoose = require('mongoose');

const arTryOnLookSchema = new mongoose.Schema(
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
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    size: {
      type: String,
      trim: true,
      default: '',
    },
    fitScore: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    source: {
      type: String,
      trim: true,
      default: 'ar_live',
    },
    shareCount: {
      type: Number,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ArTryOnLook', arTryOnLookSchema);
