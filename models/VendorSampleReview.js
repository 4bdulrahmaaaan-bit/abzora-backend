const mongoose = require('mongoose');

const vendorSampleReviewSchema = new mongoose.Schema(
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
    sampleImages: {
      type: [String],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['pending_review', 'needs_rework', 'approved', 'rejected'],
      default: 'pending_review',
      index: true,
    },
    reviewedBy: {
      type: String,
      trim: true,
      default: '',
    },
    reviewedAt: {
      type: String,
      default: '',
    },
    adminFeedback: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('VendorSampleReview', vendorSampleReviewSchema);
