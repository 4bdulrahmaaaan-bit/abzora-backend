const mongoose = require('mongoose');

const withdrawalRequestSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    walletType: {
      type: String,
      enum: ['vendor', 'rider'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'rejected'],
      default: 'pending',
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    storeId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    riderId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    requestedAt: {
      type: String,
      trim: true,
      default: '',
    },
    processedAt: {
      type: String,
      trim: true,
      default: '',
    },
    processedBy: {
      type: String,
      trim: true,
      default: '',
    },
    approvedAt: {
      type: String,
      trim: true,
      default: '',
    },
    completedAt: {
      type: String,
      trim: true,
      default: '',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    payoutMode: {
      type: String,
      enum: ['', 'UPI', 'IMPS'],
      default: '',
      trim: true,
    },
    payoutId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    razorpayContactId: {
      type: String,
      trim: true,
      default: '',
    },
    razorpayFundAccountId: {
      type: String,
      trim: true,
      default: '',
    },
    idempotencyKey: {
      type: String,
      trim: true,
      default: '',
    },
    failureReason: {
      type: String,
      trim: true,
      default: '',
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    auditOrderIds: {
      type: [String],
      default: [],
    },
    metadata: {
      type: Map,
      of: String,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('WithdrawalRequest', withdrawalRequestSchema);
