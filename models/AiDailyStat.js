const mongoose = require('mongoose');

const aiDailyStatSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    totalRequests: {
      type: Number,
      default: 0,
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    aiRequests: {
      type: Number,
      default: 0,
    },
    logicRequests: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('AiDailyStat', aiDailyStatSchema);
