const mongoose = require('mongoose');

const userMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    preferredStyle: {
      type: String,
      trim: true,
      default: '',
    },
    size: {
      type: String,
      trim: true,
      default: '',
    },
    heightCm: {
      type: Number,
      default: null,
    },
    weightKg: {
      type: Number,
      default: null,
    },
    bodyType: {
      type: String,
      trim: true,
      default: '',
    },
    recommendedSize: {
      type: String,
      trim: true,
      default: '',
    },
    pantSize: {
      type: String,
      trim: true,
      default: '',
    },
    fitPreference: {
      type: String,
      trim: true,
      default: 'regular',
    },
    shoulderCm: {
      type: Number,
      default: null,
    },
    chestCm: {
      type: Number,
      default: null,
    },
    waistCm: {
      type: Number,
      default: null,
    },
    hipCm: {
      type: Number,
      default: null,
    },
    armLengthCm: {
      type: Number,
      default: null,
    },
    inseamCm: {
      type: Number,
      default: null,
    },
    confidence: {
      type: Number,
      default: null,
    },
    scanFrameCount: {
      type: Number,
      default: null,
    },
    scanSource: {
      type: String,
      trim: true,
      default: '',
    },
    pastIssues: {
      type: [String],
      default: [],
    },
    lastOrderId: {
      type: String,
      trim: true,
      default: '',
    },
    lastConversationSummary: {
      type: String,
      trim: true,
      default: '',
    },
    cartItems: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    cartUpdatedAtIso: {
      type: String,
      trim: true,
      default: '',
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

module.exports = mongoose.model('UserMemory', userMemorySchema);
