const mongoose = require('mongoose');

const arFitModelArtifactSchema = new mongoose.Schema(
  {
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'ArFitModelRun', required: true, index: true },
    modelVersion: { type: String, required: true, trim: true, index: true },
    artifactType: {
      type: String,
      enum: ['weights', 'metrics', 'feature_map', 'calibration_map', 'eval_report'],
      required: true,
    },
    uri: { type: String, required: true, trim: true },
    checksum: { type: String, default: '', trim: true },
    bytes: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'ar_fit_model_artifacts' },
);

arFitModelArtifactSchema.index({ modelVersion: 1, artifactType: 1, createdAt: -1 });

module.exports = mongoose.model('ArFitModelArtifact', arFitModelArtifactSchema);
