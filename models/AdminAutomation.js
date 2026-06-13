const mongoose = require('mongoose');

const automationExecutionSchema = new mongoose.Schema(
  {
    executedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['success', 'failure'], required: true },
    details: { type: String, default: '' },
  },
  { _id: false }
);

const adminAutomationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    cronExpression: { type: String, required: true }, // e.g. "0 0 * * *"
    enabled: { type: Boolean, default: false },
    lastRunAt: { type: Date, default: null },
    nextRunAt: { type: Date, default: null },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    executionHistory: [automationExecutionSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminAutomation', adminAutomationSchema);
