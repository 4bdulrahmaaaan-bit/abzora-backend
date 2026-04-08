const mongoose = require('mongoose');

const trainingModuleSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed'],
      default: 'pending',
    },
    completedAt: {
      type: String,
      default: '',
    },
    score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const vendorTrainingProgressSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    vendorType: {
      type: String,
      enum: ['custom_vendor'],
      default: 'custom_vendor',
    },
    modules: {
      type: [trainingModuleSchema],
      default: [],
    },
    trainingStatus: {
      type: String,
      enum: ['not_started', 'in_progress', 'completed'],
      default: 'not_started',
    },
    lastUpdatedAt: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

vendorTrainingProgressSchema.index({ vendorId: 1, storeId: 1 }, { unique: true });

module.exports = mongoose.model('VendorTrainingProgress', vendorTrainingProgressSchema);
