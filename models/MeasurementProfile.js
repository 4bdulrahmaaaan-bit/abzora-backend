const mongoose = require('mongoose');

const measurementProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    method: {
      type: String,
      trim: true,
      default: 'manual',
    },
    unit: {
      type: String,
      trim: true,
      default: 'cm',
    },
    chest: {
      type: Number,
      default: 0,
    },
    shoulder: {
      type: Number,
      default: 0,
    },
    waist: {
      type: Number,
      default: 0,
    },
    sleeve: {
      type: Number,
      default: 0,
    },
    length: {
      type: Number,
      default: 0,
    },
    standardSize: {
      type: String,
      trim: true,
      default: '',
    },
    recommendedSize: {
      type: String,
      trim: true,
      default: '',
    },
    sourceProfileId: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('MeasurementProfile', measurementProfileSchema);
