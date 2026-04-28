const mongoose = require('mongoose');

const opsMetricsSnapshotSchema = new mongoose.Schema(
  {
    bucketType: {
      type: String,
      enum: ['hourly', 'daily'],
      required: true,
      index: true,
    },
    bucketStartAt: {
      type: Date,
      required: true,
      index: true,
    },
    totals: {
      deliveries: { type: Number, default: 0 },
      delayedDeliveries: { type: Number, default: 0 },
      dispatchSuccess: { type: Number, default: 0 },
      dispatchFailures: { type: Number, default: 0 },
      etaAccuracy: { type: Number, default: 0 },
      autoResolvedAlerts: { type: Number, default: 0 },
      totalAlerts: { type: Number, default: 0 },
      queueDepth: { type: Number, default: 0 },
      retryBacklog: { type: Number, default: 0 },
      escalatedAlerts: { type: Number, default: 0 },
      manualReviewAlerts: { type: Number, default: 0 },
      fallbackCancellations: { type: Number, default: 0 },
      workerLoopFailures: { type: Number, default: 0 },
      workerExecutionFailures: { type: Number, default: 0 },
      riderEfficiency: { type: Number, default: 0 },
      vendorEfficiency: { type: Number, default: 0 },
      avgDeliveryMinutes: { type: Number, default: 0 },
      delayPercent: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
    collection: 'ops_metrics_snapshots',
  },
);

opsMetricsSnapshotSchema.index({ bucketType: 1, bucketStartAt: 1 }, { unique: true });

module.exports = mongoose.model('OpsMetricsSnapshot', opsMetricsSnapshotSchema);
