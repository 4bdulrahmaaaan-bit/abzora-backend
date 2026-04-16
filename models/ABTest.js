const mongoose = require('mongoose');

const variantSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    weight: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false },
);

const abTestSchema = new mongoose.Schema(
  {
    testKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      uppercase: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    dimension: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'PAUSED'],
      default: 'ACTIVE',
      index: true,
    },
    variants: {
      type: [variantSchema],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true, collection: 'ab_tests' },
);

module.exports = mongoose.model('ABTest', abTestSchema);
