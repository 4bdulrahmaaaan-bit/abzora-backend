const mongoose = require('mongoose');

const invoiceJobSchema = new mongoose.Schema(
  {
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true, unique: true },
    trigger: { type: String, trim: true, default: 'payment_confirmed' },
    status: {
      type: String,
      enum: ['queued', 'processing', 'done', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    runAfter: { type: Date, default: Date.now, index: true },
    lastError: { type: String, trim: true, default: '' },
    invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
  },
  { timestamps: true },
);

invoiceJobSchema.index({ status: 1, runAfter: 1 });

module.exports = mongoose.model('InvoiceJob', invoiceJobSchema);
