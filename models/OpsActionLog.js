const mongoose = require('mongoose');

const opsActionLogSchema = new mongoose.Schema(
  {
    alertId: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['STARTED', 'SUCCESS', 'FAILED', 'SKIPPED', 'MANUAL'],
      default: 'STARTED',
      index: true,
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
    actorId: {
      type: String,
      default: 'system',
      trim: true,
      index: true,
    },
    attempt: {
      type: Number,
      default: 0,
      min: 0,
    },
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    error: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'ops_action_logs',
  },
);

opsActionLogSchema.index({ createdAt: -1, status: 1 });

module.exports = mongoose.model('OpsActionLog', opsActionLogSchema);
