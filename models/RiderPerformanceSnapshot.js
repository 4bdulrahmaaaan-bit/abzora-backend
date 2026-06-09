const mongoose = require('mongoose');

const riderPerformanceSnapshotSchema = new mongoose.Schema(
  {
    riderId: { type: String, required: true, index: true },
    riderScore: { type: Number, default: 100 },
    acceptanceRate: { type: Number, default: 100 },
    completionRate: { type: Number, default: 100 },
    averageDeliveryTime: { type: Number, default: 0 }, // in minutes
    averageTrialTime: { type: Number, default: 0 }, // in minutes
    customerRating: { type: Number, default: 5.0 },
    trialSuccessRate: { type: Number, default: 100 },
    trialConversionRate: { type: Number, default: 0 },
    noShowRate: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

riderPerformanceSnapshotSchema.index({ riderId: 1, createdAt: -1 });

module.exports = mongoose.model('RiderPerformanceSnapshot', riderPerformanceSnapshotSchema);
