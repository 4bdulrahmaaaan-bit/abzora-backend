const mongoose = require('mongoose');

const cloudinaryAssetSchema = new mongoose.Schema({
  publicId: { type: String, trim: true, default: '' },
  secureUrl: { type: String, trim: true, default: '' },
  version: { type: Number, default: 1 },
  bytes: { type: Number, default: 0 },
  checksum: { type: String, trim: true, default: '' },
  resourceType: { type: String, trim: true, default: 'raw' },
  type: { type: String, trim: true, default: 'authenticated' },
  folder: { type: String, trim: true, default: '' },
  tags: { type: [String], default: [] },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { _id: false });

const invoiceItemSchema = new mongoose.Schema(
  {
    productId: { type: String, trim: true, default: '' },
    name: { type: String, required: true, trim: true },
    hsnSac: { type: String, trim: true, default: '' },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    taxableValue: { type: Number, required: true, min: 0 },
    gstRate: { type: Number, default: 0, min: 0 },
    cgstAmount: { type: Number, default: 0, min: 0 },
    sgstAmount: { type: Number, default: 0, min: 0 },
    igstAmount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceAddressSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    addressLine1: { type: String, trim: true, default: '' },
    addressLine2: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    pincode: { type: String, trim: true, default: '' },
    gstin: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const settlementSchema = new mongoose.Schema(
  {
    vendorGross: { type: Number, default: 0, min: 0 },
    platformCommission: { type: Number, default: 0, min: 0 },
    commissionPercent: { type: Number, default: 0, min: 0 },
    paymentGatewayFee: { type: Number, default: 0, min: 0 },
    vendorNet: { type: Number, default: 0 },
    riderEarnings: { type: Number, default: 0, min: 0 },
    settlementStatus: {
      type: String,
      enum: ['pending', 'partially_settled', 'settled', 'on_hold'],
      default: 'pending',
    },
  },
  { _id: false },
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, index: true, unique: true },
    customerId: { type: String, required: true, index: true },
    vendorId: { type: String, trim: true, default: '', index: true },
    items: { type: [invoiceItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    tax: { type: Number, required: true, min: 0 },
    cgst: { type: Number, default: 0, min: 0 },
    sgst: { type: Number, default: 0, min: 0 },
    igst: { type: Number, default: 0, min: 0 },
    shippingCharge: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, trim: true, default: '' },
    paymentStatus: { type: String, trim: true, default: 'pending', index: true },
    billingAddress: { type: invoiceAddressSchema, default: () => ({}) },
    shippingAddress: { type: invoiceAddressSchema, default: () => ({}) },
    invoicePdfUrl: { type: String, trim: true, default: '' },
    cloudinaryAsset: { type: cloudinaryAssetSchema, default: () => ({}) },
    generatedAt: { type: Date, default: Date.now, index: true },
    status: {
      type: String,
      enum: ['generated', 'cancelled', 'credit_note_issued', 'refunded', 'partially_refunded'],
      default: 'generated',
      index: true,
    },
    versionLabel: { type: String, trim: true, default: 'v1' },
    versionSequence: { type: Number, default: 1 },
    isRefundInvoice: { type: Boolean, default: false },
    parentInvoiceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice', default: null },
    creditNoteNumber: { type: String, trim: true, default: '' },
    upiReference: { type: String, trim: true, default: '' },
    walletAmount: { type: Number, default: 0, min: 0 },
    signedHash: { type: String, trim: true, default: '' },
    immutableSnapshot: { type: mongoose.Schema.Types.Mixed, required: true, default: {} },
    settlement: { type: settlementSchema, default: () => ({}) },
    qrPayload: { type: String, trim: true, default: '' },
    emailedAt: { type: Date, default: null },
    lastDownloadedAt: { type: Date, default: null },
    freezeState: {
      type: String,
      enum: ['none', 'frozen', 'locked'],
      default: 'none',
      index: true,
    },
    legalHold: { type: Boolean, default: false, index: true },
    retentionUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

invoiceSchema.index({ customerId: 1, generatedAt: -1 });
invoiceSchema.index({ vendorId: 1, generatedAt: -1 });
invoiceSchema.index({ paymentStatus: 1, generatedAt: -1 });
invoiceSchema.index({ status: 1, generatedAt: -1 });
invoiceSchema.index({ invoiceNumber: 'text', customerId: 'text', vendorId: 'text' });

module.exports = mongoose.model('Invoice', invoiceSchema);
