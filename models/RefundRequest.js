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
      trim: true,
      default: '',
      index: true,
    },
    vendorId: {
      type: String,
      default: '',
      index: true,
      trim: true,
    },
    customerId: {
      type: String,
      default: '',
      index: true,
      trim: true,
    },
    amount: {
      type: Number,
      default: 0,
      min: 0,
    },
    requestedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'processing', 'refunded', 'closed', 'rejected', 'pending'], // Keeping 'pending' to not break existing instances unexpectedly
      default: 'requested',
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
    collection: 'refund_requests',
  }
);

module.exports = mongoose.model('RefundRequest', refundRequestSchema);
