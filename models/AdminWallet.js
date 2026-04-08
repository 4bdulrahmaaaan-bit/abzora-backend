const mongoose = require('mongoose');

const adminWalletSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'primary',
      trim: true,
    },
    totalCommission: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalRevenue: {
      type: Number,
      default: 0,
      min: 0,
    },
    payoutsDone: {
      type: Number,
      default: 0,
      min: 0,
    },
    vendorSettlementsDone: {
      type: Number,
      default: 0,
      min: 0,
    },
    riderSettlementsDone: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminWallet', adminWalletSchema);
