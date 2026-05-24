const mongoose = require('mongoose');

const arDeviceLabRunSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    scenario: { type: String, default: 'soak_30m', trim: true },
    deviceMatrix: { type: [mongoose.Schema.Types.Mixed], default: [] },
    telemetry: { type: [mongoose.Schema.Types.Mixed], default: [] },
    summary: {
      devices: { type: Number, default: 0 },
      passCount: { type: Number, default: 0 },
      failCount: { type: Number, default: 0 },
      avgFps: { type: Number, default: 0 },
      avgThermal: { type: Number, default: 0 },
      crashRate: { type: Number, default: 0 },
    },
    createdBy: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'ar_device_lab_runs' },
);

arDeviceLabRunSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ArDeviceLabRun', arDeviceLabRunSchema);
