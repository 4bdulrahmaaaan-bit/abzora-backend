const mongoose = require('mongoose');

const userAiUsageStatSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    totalMessages: {
      type: Number,
      default: 0,
    },
    aiMessages: {
      type: Number,
      default: 0,
    },
    lastUsed: {
      type: String,
      trim: true,
      default: '',
    },
    dailyUsage: {
      type: Number,
      default: 0,
    },
    dateKey: {
      type: String,
      trim: true,
      default: '',
    },
    aiCallsToday: {
      type: Number,
      default: 0,
    },
    tokensToday: {
      type: Number,
      default: 0,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
    dailyCost: {
      type: Number,
      default: 0,
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    blockedToday: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('UserAiUsageStat', userAiUsageStatSchema);
