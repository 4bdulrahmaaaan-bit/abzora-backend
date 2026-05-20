const mongoose = require('mongoose');

const invoiceEmailSuppressionSchema = new mongoose.Schema({
  email: { type: String, required: true, trim: true, lowercase: true, unique: true, index: true },
  reason: { type: String, enum: ['bounce', 'complaint', 'manual'], default: 'bounce', index: true },
  source: { type: String, trim: true, default: 'resend_webhook' },
  providerMessageId: { type: String, trim: true, default: '' },
  active: { type: Boolean, default: true, index: true },
  notes: { type: String, trim: true, default: '' },
  expiresAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('InvoiceEmailSuppression', invoiceEmailSuppressionSchema);
