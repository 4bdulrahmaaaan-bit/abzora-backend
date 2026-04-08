const mongoose = require('mongoose');

const vendorWalletSchema = new mongoose.Schema(
  {
    storeId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    ownerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    pendingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalEarnings: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalWithdrawn: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastSettlementDate: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('VendorWallet', vendorWalletSchema);
