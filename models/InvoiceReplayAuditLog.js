const mongoose = require('mongoose');

const invoiceReplayAuditLogSchema = new mongoose.Schema({
  queueName: { type: String, required: true, trim: true, index: true },
  jobId: { type: String, trim: true, default: '', index: true },
  action: { type: String, enum: ['replay_requested', 'replay_executed', 'replay_rejected', 'queue_paused', 'queue_resumed'], required: true, index: true },
  actorId: { type: String, trim: true, default: '' },
  actorRole: { type: String, trim: true, default: '' },
  ipAddress: { type: String, trim: true, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('InvoiceReplayAuditLog', invoiceReplayAuditLogSchema);
