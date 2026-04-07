const mongoose = require('mongoose');

const returnRequestSchema = new mongoose.Schema(
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
    address: {
      type: String,
      required: true,
      trim: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'assigned', 'picked', 'completed', 'rejected'],
      default: 'requested',
      index: true,
    },
    riderId: {
      type: String,
      trim: true,
      default: '',
    },
    pickupTaskId: {
      type: String,
      trim: true,
      default: '',
    },
    approvedAt: {
      type: String,
      trim: true,
      default: '',
    },
    pickedAt: {
      type: String,
      trim: true,
      default: '',
    },
    completedAt: {
      type: String,
      trim: true,
      default: '',
    },
    processedBy: {
      type: String,
      trim: true,
      default: '',
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
    refundRequestId: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);
