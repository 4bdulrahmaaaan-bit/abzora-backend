const mongoose = require('mongoose');

const refundInvoiceSchema = new mongoose.Schema({
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  creditNoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'CreditNote', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  refundTransactionId: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending', index: true },
  refundedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('RefundInvoice', refundInvoiceSchema);
