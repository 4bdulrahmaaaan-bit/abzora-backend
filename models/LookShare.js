const mongoose = require('mongoose');

const lookShareSchema = new mongoose.Schema(
  {
    shareCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    lookId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ArTryOnLook',
      default: null,
      index: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    caption: {
      type: String,
      trim: true,
      default: '',
    },
    outfitId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    productIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Product',
      default: [],
    },
    feedbackCounts: {
      type: {
        looksGood: { type: Number, default: 0, min: 0 },
        mustBuy: { type: Number, default: 0, min: 0 },
        notGreat: { type: Number, default: 0, min: 0 },
      },
      default: () => ({ looksGood: 0, mustBuy: 0, notGreat: 0 }),
    },
    feedbackByUser: {
      type: Map,
      of: String,
      default: {},
    },
    visibility: {
      type: String,
      trim: true,
      default: 'public',
      enum: ['public', 'private'],
    },
    source: {
      type: String,
      trim: true,
      default: 'ar_live',
    },
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    shareCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LookShare', lookShareSchema);
