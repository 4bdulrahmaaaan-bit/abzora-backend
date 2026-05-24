const mongoose = require('mongoose');

const arFitModelRunSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    datasetVersion: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['queued', 'training', 'evaluated', 'rolled_out', 'failed'],
      default: 'queued',
      index: true,
    },
    modelVersion: { type: String, default: '', trim: true, index: true },
    trainingConfig: { type: mongoose.Schema.Types.Mixed, default: {} },
    metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
    rollout: {
      enabled: { type: Boolean, default: false },
      percentage: { type: Number, default: 0, min: 0, max: 100 },
      channel: { type: String, default: 'shadow' },
      startedAt: { type: Date, default: null },
    },
    notes: { type: String, default: '', trim: true },
    createdBy: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'ar_fit_model_runs' },
);

arFitModelRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ArFitModelRun', arFitModelRunSchema);
