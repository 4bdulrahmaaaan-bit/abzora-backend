const mongoose = require('mongoose');

const invoiceEmailLogSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
  creditNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', default: null, index: true },
  customerId: { type: String, trim: true, default: '', index: true },
  email: { type: String, trim: true, default: '' },
  subject: { type: String, trim: true, default: '' },
  provider: { type: String, trim: true, default: 'resend' },
  providerMessageId: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: ['queued', 'sent', 'failed', 'delivered', 'bounced', 'complained', 'suppressed', 'replayed'],
    default: 'queued',
    index: true,
  },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  lastError: { type: String, trim: true, default: '' },
  nextRetryAt: { type: Date, default: Date.now, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastWebhookEvent: { type: String, trim: true, default: '' },
  bouncedAt: { type: Date, default: null },
  complainedAt: { type: Date, default: null },
  suppressedAt: { type: Date, default: null },
  replayedAt: { type: Date, default: null },
}, { timestamps: true });

invoiceEmailLogSchema.index({ status: 1, nextRetryAt: 1 });

module.exports = mongoose.model('InvoiceEmailLog', invoiceEmailLogSchema);
