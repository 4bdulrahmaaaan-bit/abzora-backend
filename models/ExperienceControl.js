const mongoose = require('mongoose');

const experienceControlSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'default',
      unique: true,
      trim: true,
      index: true,
    },
    thresholds: {
      highFitConfidence: { type: Number, default: 85, min: 0, max: 100 },
      lowFitConfidence: { type: Number, default: 70, min: 0, max: 100 },
      highReturnRate: { type: Number, default: 35, min: 0, max: 100 },
      highFitRisk: { type: Number, default: 0.65, min: 0, max: 1 },
    },
    toggles: {
      ruleEngineEnabled: { type: Boolean, default: true },
      urgencyEnabled: { type: Boolean, default: true },
      mlEnabled: { type: Boolean, default: true },
      abTestingEnabled: { type: Boolean, default: true },
    },
    ml: {
      epsilon: { type: Number, default: 0.15, min: 0, max: 1 },
      learningRate: { type: Number, default: 0.08, min: 0.0001, max: 1 },
    },
    updatedBy: {
      type: String,
      default: 'system',
      trim: true,
    },
  },
  { timestamps: true, collection: 'experience_controls' },
);

module.exports = mongoose.model('ExperienceControl', experienceControlSchema);
