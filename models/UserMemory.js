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
    confidence: {
      type: Number,
      default: null,
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
