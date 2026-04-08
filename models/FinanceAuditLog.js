const mongoose = require('mongoose');

const financeAuditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    actorId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    actorRole: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['success', 'failed', 'requested', 'approved', 'rejected'],
      default: 'success',
      index: true,
    },
    walletType: {
      type: String,
      enum: ['', 'vendor', 'rider', 'admin'],
      default: '',
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
    orderIds: {
      type: [String],
      default: [],
    },
    withdrawalRequestId: {
      type: String,
      trim: true,
      default: '',
    },
    payoutId: {
      type: String,
      trim: true,
      default: '',
    },
    amount: {
      type: Number,
      default: 0,
    },
    message: {
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
      default: () => ({}),
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('FinanceAuditLog', financeAuditLogSchema);
