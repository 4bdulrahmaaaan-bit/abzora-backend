const mongoose = require('mongoose');

const aiUsageLogSchema = new mongoose.Schema(
  {
    logId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      default: '',
    },
    responseLength: {
      type: Number,
      default: 0,
    },
    tokensUsed: {
      type: Number,
      default: 0,
    },
    cost: {
      type: Number,
      default: 0,
    },
    costPerRequest: {
      type: Number,
      default: 0,
    },
    timestamp: {
      type: String,
      required: true,
      trim: true,
    },
    intentType: {
      type: String,
      trim: true,
      default: 'ai_needed',
    },
    usedAi: {
      type: Boolean,
      default: false,
    },
    source: {
      type: String,
      trim: true,
      default: 'logic',
    },
    modelName: {
      type: String,
      trim: true,
      default: '',
    },
    cacheKey: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AiUsageLog', aiUsageLogSchema);
