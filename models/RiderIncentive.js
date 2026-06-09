const mongoose = require('mongoose');

const riderIncentiveSchema = new mongoose.Schema(
  {
    riderId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    description: { type: String, default: '' },
    target: { type: Number, required: true },
    currentProgress: { type: Number, default: 0 },
    rewardAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['active', 'completed', 'expired'],
      default: 'active',
      index: true
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  {
    timestamps: true,
  }
);

riderIncentiveSchema.index({ riderId: 1, status: 1 });

module.exports = mongoose.model('RiderIncentive', riderIncentiveSchema);
