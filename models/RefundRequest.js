const mongoose = require('mongoose');

const refundRequestSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    processedBy: {
      type: String,
      trim: true,
      default: '',
    },
    processedAt: {
      type: String,
      trim: true,
      default: '',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    gatewayRefundId: {
      type: String,
      trim: true,
      default: '',
    },
    fraudScore: {
      type: Number,
      default: 0,
    },
    fraudDecision: {
      type: String,
      trim: true,
      default: 'approve',
    },
    fraudReasons: {
      type: [String],
      default: () => [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('RefundRequest', refundRequestSchema);
