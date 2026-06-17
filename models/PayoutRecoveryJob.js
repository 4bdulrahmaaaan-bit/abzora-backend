const mongoose = require('mongoose');

const payoutRecoveryJobSchema = new mongoose.Schema(
  {
    withdrawalRequestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    userRole: {
      type: String,
      required: true,
      enum: ['vendor', 'rider', 'admin'],
      index: true,
      trim: true,
    },
    razorpayPayoutId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'investigating', 'recovered', 'manual_review', 'failed'],
      default: 'pending',
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastCheckedAt: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    resolvedAt: {
      type: String,
      trim: true,
      default: '',
    },
    failureReason: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: Map,
      of: String,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PayoutRecoveryJob', payoutRecoveryJobSchema);
