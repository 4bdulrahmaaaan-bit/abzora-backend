const mongoose = require('mongoose');

const exchangeRequestSchema = new mongoose.Schema(
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
    originalProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    replacementProductId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['requested', 'approved', 'rejected', 'replacement_shipped', 'delivered', 'closed'],
      default: 'requested',
      index: true,
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
    collection: 'exchange_requests',
  }
);

module.exports = mongoose.model('ExchangeRequest', exchangeRequestSchema);
