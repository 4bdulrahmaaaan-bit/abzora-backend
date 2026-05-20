const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema({
  itemName: { type: String, trim: true, default: '' },
  quantity: { type: Number, default: 1 },
  refundAmount: { type: Number, default: 0 },
  refundedTax: { type: Number, default: 0 },
  refundedCgst: { type: Number, default: 0 },
  refundedSgst: { type: Number, default: 0 },
  refundedIgst: { type: Number, default: 0 },
}, { _id: false });

const creditNoteSchema = new mongoose.Schema({
  creditNoteNumber: { type: String, required: true, unique: true, index: true },
  invoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  customerId: { type: String, required: true, index: true },
  vendorId: { type: String, trim: true, default: '', index: true },
  reason: { type: String, trim: true, default: 'refund' },
  refundType: { type: String, enum: ['full', 'partial', 'item_wise', 'shipping_only'], default: 'full' },
  lines: { type: [lineSchema], default: [] },
  refundAmount: { type: Number, required: true, min: 0 },
  refundTax: { type: Number, default: 0, min: 0 },
  refundCgst: { type: Number, default: 0, min: 0 },
  refundSgst: { type: Number, default: 0, min: 0 },
  refundIgst: { type: Number, default: 0, min: 0 },
  refundShipping: { type: Number, default: 0, min: 0 },
  paymentGatewayRefundId: { type: String, trim: true, default: '' },
  status: { type: String, enum: ['generated', 'emailed', 'cancelled'], default: 'generated', index: true },
  immutableSnapshot: { type: mongoose.Schema.Types.Mixed, default: {} },
  signedHash: { type: String, trim: true, default: '' },
}, { timestamps: true });

creditNoteSchema.index({ generatedAt: -1 });

module.exports = mongoose.model('CreditNote', creditNoteSchema);
