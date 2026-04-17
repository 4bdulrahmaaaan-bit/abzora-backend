const mongoose = require('mongoose');

const alertTypes = [
  'STUCK_ORDER',
  'DELAYED_ORDER',
  'RIDER_INACTIVE',
  'DISPATCH_FAILED',
  'ETA_RISK',
  'VENDOR_DELAY',
  'PAYMENT_FAILED',
];

const severities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const statuses = ['OPEN', 'QUEUED', 'PROCESSING', 'RESOLVED', 'FAILED', 'ESCALATED'];

const opsAlertSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      enum: alertTypes,
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: severities,
      default: 'LOW',
      index: true,
    },
    score: {
      type: Number,
      default: 0,
      index: true,
    },
    status: {
      type: String,
      enum: statuses,
      default: 'OPEN',
      index: true,
    },
    title: {
      type: String,
      default: '',
      trim: true,
    },
    message: {
      type: String,
      default: '',
      trim: true,
    },
    entityType: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    entityId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    orderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    taskId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    batchId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    riderId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    vendorId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    action: {
      type: String,
      default: '',
      trim: true,
    },
    actionStatus: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'DONE', 'FAILED'],
      default: 'PENDING',
    },
    retryCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
      min: 0,
    },
    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },
    escalatedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    queuedAt: {
      type: Date,
      default: null,
      index: true,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastError: {
      type: String,
      default: '',
      trim: true,
    },
    autoResolved: {
      type: Boolean,
      default: false,
      index: true,
    },
    acknowledgedBy: {
      type: String,
      default: '',
      trim: true,
    },
    acknowledgedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'ops_alerts',
  },
);

opsAlertSchema.index({ status: 1, severity: -1, score: -1, createdAt: 1 });
opsAlertSchema.index({ entityType: 1, entityId: 1, type: 1, status: 1 });

module.exports = mongoose.model('OpsAlert', opsAlertSchema);
