const mongoose = require('mongoose');

const returnRequestSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    vendorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    customerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    returnType: {
      type: String,
      enum: ['return', 'refund', 'exchange', 'trial_return'],
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    images: {
      type: [String],
      default: () => [],
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'picked_up', 'received', 'inspected', 'closed'],
      default: 'requested',
      index: true,
    },
    isTrialOrder: {
      type: Boolean,
      default: false,
    },
    trialSessionId: {
      type: String,
      trim: true,
      default: '',
    },
    trialOutcome: {
      type: String,
      enum: ['', 'converted', 'returned', 'partial_purchase', 'cancelled', 'damaged'],
      default: '',
    },
    trialDaysUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    address: {
      type: String,
      trim: true,
      default: '',
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
    processedBy: {
      type: String,
      trim: true,
      default: '',
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
    collection: 'return_requests',
  }
);

module.exports = mongoose.model('ReturnRequest', returnRequestSchema);
