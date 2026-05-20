const mongoose = require('mongoose');

const invoiceAuditLogSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', index: true, default: null },
  creditNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', index: true, default: null },
  action: { type: String, required: true, index: true },
  actorId: { type: String, trim: true, default: '' },
  actorRole: { type: String, trim: true, default: '' },
  ipAddress: { type: String, trim: true, default: '' },
  userAgent: { type: String, trim: true, default: '' },
  deviceMetadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  immutableHash: { type: String, trim: true, default: '' },
}, { timestamps: true });

invoiceAuditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('InvoiceAuditLog', invoiceAuditLogSchema);
