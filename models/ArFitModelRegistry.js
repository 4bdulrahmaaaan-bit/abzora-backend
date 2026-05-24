const mongoose = require('mongoose');

const arFitModelRegistrySchema = new mongoose.Schema(
  {
    channel: {
      type: String,
      enum: ['shadow', 'canary', 'production'],
      required: true,
      index: true,
    },
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArFitModelRun', required: true },
    modelVersion: { type: String, required: true, trim: true },
    datasetVersion: { type: String, required: true, trim: true },
    rolloutPercentage: { type: Number, default: 0, min: 0, max: 100 },
    notes: { type: String, default: '', trim: true },
    promotedBy: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'ar_fit_model_registry' },
);

arFitModelRegistrySchema.index({ channel: 1, createdAt: -1 });

module.exports = mongoose.model('ArFitModelRegistry', arFitModelRegistrySchema);
