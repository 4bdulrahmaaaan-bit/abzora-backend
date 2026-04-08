const mongoose = require('mongoose');

const fraudAlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['order', 'withdrawal', 'refund', 'account'],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'reviewing', 'resolved', 'ignored'],
      default: 'open',
      index: true,
    },
    userId: {
      type: String,
      trim: true,
      default: '',
      index: true,
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
    withdrawalRequestId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    refundRequestId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
    },
    reasons: {
      type: [String],
      default: [],
    },
    message: {
      type: String,
      trim: true,
      default: '',
    },
    ipAddress: {
      type: String,
      trim: true,
      default: '',
    },
    deviceId: {
      type: String,
      trim: true,
      default: '',
    },
    relatedOrderIds: {
      type: [String],
      default: [],
    },
    metadata: {
      type: Map,
      of: String,
      default: () => ({}),
    },
    reviewedBy: {
      type: String,
      trim: true,
      default: '',
    },
    reviewedAt: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
