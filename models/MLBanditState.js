const mongoose = require('mongoose');

const mlBanditStateSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      unique: true,
      index: true,
      enum: ['BUY_NOW', 'TRY_HOME', 'HYBRID'],
    },
    pulls: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalReward: {
      type: Number,
      default: 0,
      min: 0,
    },
    avgReward: {
      type: Number,
      default: 0,
      min: 0,
    },
    explorationCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    bias: {
      type: Number,
      default: 0,
    },
    weights: {
      type: Map,
      of: Number,
      default: {},
    },
    lastUpdatedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true, collection: 'ml_bandit_states' },
);

module.exports = mongoose.model('MLBanditState', mlBanditStateSchema);
