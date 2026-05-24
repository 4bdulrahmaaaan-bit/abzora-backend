const mongoose = require('mongoose');

const arGarmentCertificationJobSchema = new mongoose.Schema(
  {
    productIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    mode: { type: String, enum: ['incremental', 'full'], default: 'incremental' },
    summary: {
      scanned: { type: Number, default: 0 },
      certified: { type: Number, default: 0 },
      rejected: { type: Number, default: 0 },
      generatedLod: { type: Number, default: 0 },
    },
    findings: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdBy: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'ar_garment_cert_jobs' },
);

arGarmentCertificationJobSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ArGarmentCertificationJob', arGarmentCertificationJobSchema);
