const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['order', 'commission', 'payout'],
      required: true,
    },
    userType: {
      type: String,
      enum: ['vendor', 'rider', 'admin'],
      required: true,
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
    orderId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    payoutId: {
      type: String,
      trim: true,
      default: '',
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      default: 'pending',
      trim: true,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    createdAtIso: {
      type: String,
      trim: true,
      default: '',
    },
    metadata: {
      type: Map,
      of: String,
      default: {},
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Transaction', transactionSchema);
