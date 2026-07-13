const mongoose = require('mongoose');

const Invoice = require('../models/Invoice');
const InvoiceJob = require('../models/InvoiceJob');
const CreditNote = require('../models/CreditNote');
const RefundInvoice = require('../models/RefundInvoice');
const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');
const { computeInvoiceTax } = require('./invoiceGstService');
const { nextInvoiceNumber, nextCreditNoteNumber, buildInvoiceSnapshotHash } = require('./invoiceNumberService');
const { generateInvoicePdf } = require('./invoicePdfRendererService');
const { savePdf } = require('./invoiceStorageService');
const { queueInvoiceEmailLog, sendInvoicePush } = require('./invoiceNotificationService');
const { buildSignedToken } = require('./invoiceSigningService');

function normalizeAddress(input = {}, fallback = {}) {
  return {
    name: String(input.name || fallback.name || '').trim(),
    phone: String(input.phone || fallback.phone || '').trim(),
    addressLine1: String(input.addressLine1 || fallback.addressLine1 || fallback.address || '').trim(),
    addressLine2: String(input.addressLine2 || fallback.addressLine2 || fallback.area || '').trim(),
    city: String(input.city || fallback.city || '').trim(),
    state: String(input.state || fallback.state || fallback.area || '').trim(),
    pincode: String(input.pincode || fallback.pincode || '').trim(),
    gstin: String(input.gstin || fallback.gstin || '').trim(),
  };
}

async function buildInvoiceDraft(order) {
  const [customer, store] = await Promise.all([
    User.findOne({ uid: order.userId }),
    Store.findById(order.storeId),
  ]);

  const shippingAddress = normalizeAddress(order.shippingAddress || {}, customer || {});
  const billingAddress = normalizeAddress(order.shippingAddress || {}, customer || {});
  const taxBreakdown = computeInvoiceTax({
    order,
    items: order.items || [],
    originState: store?.state || process.env.ABZORA_ORIGIN_STATE || 'Tamil Nadu',
    destinationState: shippingAddress.state,
  });

  const immutableSnapshot = {
    orderId: String(order._id),
    customerId: order.userId,
    vendorId: String(store?.ownerId || ''),
    items: taxBreakdown.items,
    subtotal: taxBreakdown.subtotal,
    discount: taxBreakdown.discount,
    tax: taxBreakdown.tax,
    cgst: taxBreakdown.cgst,
    sgst: taxBreakdown.sgst,
    igst: taxBreakdown.igst,
    shippingCharge: taxBreakdown.shippingCharge,
    grandTotal: taxBreakdown.grandTotal,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    billingAddress,
    shippingAddress,
    storeName: store?.name || '',
    vendorSnapshot: {
      vendorId: String(store?.ownerId || ''),
      vendorName: String(store?.name || '').trim(),
      gstin: String(store?.gstin || '').trim(),
      addressLine1: String(store?.address || '').trim(),
      city: String(store?.city || '').trim(),
      state: String(store?.state || '').trim(),
      pincode: String(store?.pincode || '').trim(),
    },
    customerSnapshot: {
      customerId: String(order.userId || '').trim(),
      customerName: String(customer?.name || '').trim(),
      email: String(customer?.email || '').trim(),
      phone: String(customer?.phone || '').trim(),
    },
    pricingSnapshot: {
      platformCommission: Number(order.platformCommission || 0),
      commissionPercent: Number(order.commissionPercent || 0),
      paymentGatewayFee: Number(order.paymentGatewayFee || 0),
      walletApplied: Number(order.pricingBreakdown?.walletApplied || 0),
      shippingCharge: Number(taxBreakdown.shippingCharge || 0),
      discount: Number(taxBreakdown.discount || 0),
    },
    taxRatesSnapshot: (taxBreakdown.items || []).map((item) => ({
      name: item.name,
      hsnSac: item.hsnSac,
      gstRate: item.gstRate,
    })),
    generatedAtIso: new Date().toISOString(),
  };

  return {
    customer,
    store,
    shippingAddress,
    billingAddress,
    taxBreakdown,
    immutableSnapshot,
  };
}

async function createInvoiceForOrder(orderId, { forceRegenerate = false } = {}) {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new Error('Invalid order id for invoice generation.');
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new Error('Order not found.');
  }

  if (order.paymentStatus !== 'paid' && order.paymentMethod !== 'COD') {
    throw new Error('Invoice generation requires successful payment or COD order.');
  }

  const existing = await Invoice.findOne({ orderId: order._id, status: { $ne: 'cancelled' } });
  if (existing && !forceRegenerate) {
    return existing;
  }

  const draft = await buildInvoiceDraft(order);

  let invoice = existing;
  if (!invoice) {
    const invoiceNumber = await nextInvoiceNumber(new Date());
    invoice = new Invoice({
      invoiceNumber,
      orderId: order._id,
      customerId: order.userId,
      vendorId: String(draft.store?.ownerId || ''),
    });
  }

  invoice.items = draft.taxBreakdown.items;
  invoice.subtotal = draft.taxBreakdown.subtotal;
  invoice.discount = draft.taxBreakdown.discount;
  invoice.tax = draft.taxBreakdown.tax;
  invoice.cgst = draft.taxBreakdown.cgst;
  invoice.sgst = draft.taxBreakdown.sgst;
  invoice.igst = draft.taxBreakdown.igst;
  invoice.shippingCharge = draft.taxBreakdown.shippingCharge;
  invoice.grandTotal = draft.taxBreakdown.grandTotal;
  invoice.paymentMethod = order.paymentMethod || '';
  invoice.paymentStatus = order.paymentStatus || 'pending';
  invoice.billingAddress = draft.billingAddress;
  invoice.shippingAddress = draft.shippingAddress;
  invoice.generatedAt = new Date();
  invoice.status = order.paymentStatus === 'refunded' ? 'refunded' : 'generated';
  invoice.upiReference = String(order.razorpay?.paymentId || '').trim();
  invoice.walletAmount = Number(order.pricingBreakdown?.walletApplied || 0);
  invoice.settlement = {
    vendorGross: Number(order.subtotalAmount || 0),
    platformCommission: Number(order.platformCommission || 0),
    commissionPercent: Number(order.commissionPercent || 0),
    paymentGatewayFee: Number(order.paymentGatewayFee || 0),
    vendorNet: Number(order.vendorEarnings || 0),
    riderEarnings: Number(order.riderEarnings || 0),
    settlementStatus: order.payoutStatus === 'processed' ? 'settled' : 'pending',
  };

  invoice.immutableSnapshot = draft.immutableSnapshot;
  invoice.signedHash = buildInvoiceSnapshotHash(draft.immutableSnapshot);

  const { pdfBuffer, qrPayload } = await generateInvoicePdf({
    invoice,
    order,
    customer: draft.customer,
    store: draft.store,
  });
  const versionSequence = forceRegenerate && existing ? (Number(existing.versionSequence || 1) + 1) : Number(invoice.versionSequence || 1);
  const versionLabel = `v${versionSequence}`;
  const storage = await savePdf({
    invoiceNumber: invoice.invoiceNumber,
    versionLabel,
    pdfBuffer,
    metadata: {
      orderId: String(order._id),
      customerId: order.userId,
    },
    tags: [invoice.status, order.paymentStatus || 'pending'],
  });
  invoice.invoicePdfUrl = storage.url;
  invoice.cloudinaryAsset = {
    publicId: storage.publicId || '',
    secureUrl: storage.secureUrl || storage.url,
    version: Number(storage.version || versionSequence),
    bytes: Number(storage.bytes || pdfBuffer.length),
    checksum: storage.checksum || '',
    resourceType: storage.resourceType || 'raw',
    type: storage.type || 'authenticated',
    folder: storage.folder || '',
    tags: storage.tags || [],
    metadata: storage.metadata || {},
  };
  invoice.versionSequence = versionSequence;
  invoice.versionLabel = versionLabel;
  invoice.qrPayload = qrPayload;

  await invoice.save();

  await Order.updateOne(
    { _id: order._id },
    {
      invoiceId: invoice._id,
      invoiceNumber: invoice.invoiceNumber,
      invoicePdfUrl: invoice.invoicePdfUrl,
    }
  );

  const emailToken = buildSignedToken({
    invoiceId: String(invoice._id),
    userId: invoice.customerId,
    role: 'customer',
    version: invoice.versionLabel || 'v1',
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });
  const signedUrl = `${process.env.PUBLIC_BACKEND_URL || ''}/api/invoices/download/${invoice._id}?token=${encodeURIComponent(emailToken)}`;
  await Promise.allSettled([
    queueInvoiceEmailLog({ invoice, customerEmail: draft.customer?.email || '', signedUrl, subjectPrefix: 'Abianzo Invoice' }),
    sendInvoicePush({ invoice, userId: order.userId }),
  ]);
  return invoice;
}

async function enqueueInvoiceJob(orderId, trigger = 'payment_confirmed') {
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    return null;
  }
  await InvoiceJob.findOneAndUpdate(
    { orderId },
    {
      $setOnInsert: { orderId, trigger, status: 'queued', attempts: 0, runAfter: new Date() },
    },
    { upsert: true, new: true },
  );
  const { queueInvoiceGeneration } = require('./invoiceBullMqOrchestrator');
  await queueInvoiceGeneration(orderId, { trigger });
  return { queued: true, orderId, trigger };
}

async function createCreditNoteForRefund({
  invoiceId,
  reason = 'refund',
  refundType = 'full',
  lines = [],
  paymentGatewayRefundId = '',
  refundTransactionId = '',
}) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) {
    throw new Error('Invoice not found for credit note.');
  }
  const order = await Order.findById(invoice.orderId);
  if (!order) {
    throw new Error('Order not found for credit note.');
  }

  const creditNoteNumber = await nextCreditNoteNumber(new Date());
  const refundAmount = Number(lines.reduce((sum, line) => sum + Number(line.refundAmount || 0), 0) || invoice.grandTotal);
  const refundTax = Number(lines.reduce((sum, line) => sum + Number(line.refundedTax || 0), 0) || invoice.tax);
  const refundCgst = Number(lines.reduce((sum, line) => sum + Number(line.refundedCgst || 0), 0) || invoice.cgst);
  const refundSgst = Number(lines.reduce((sum, line) => sum + Number(line.refundedSgst || 0), 0) || invoice.sgst);
  const refundIgst = Number(lines.reduce((sum, line) => sum + Number(line.refundedIgst || 0), 0) || invoice.igst);

  const snapshot = {
    creditNoteNumber,
    invoiceNumber: invoice.invoiceNumber,
    orderId: String(order._id),
    refundType,
    reason,
    lines,
    refundAmount,
    refundTax,
    refundCgst,
    refundSgst,
    refundIgst,
    paymentGatewayRefundId,
    generatedAtIso: new Date().toISOString(),
  };

  const creditNote = await CreditNote.create({
    creditNoteNumber,
    invoiceId: invoice._id,
    orderId: order._id,
    customerId: invoice.customerId,
    vendorId: invoice.vendorId,
    reason,
    refundType,
    lines,
    refundAmount,
    refundTax,
    refundCgst,
    refundSgst,
    refundIgst,
    paymentGatewayRefundId,
    immutableSnapshot: snapshot,
    signedHash: buildInvoiceSnapshotHash(snapshot),
  });

  await RefundInvoice.create({
    invoiceId: invoice._id,
    creditNoteId: creditNote._id,
    orderId: order._id,
    refundTransactionId,
    status: 'processed',
    refundedAt: new Date(),
  });

  invoice.status = refundType === 'full' ? 'refunded' : 'partially_refunded';
  invoice.creditNoteNumber = creditNote.creditNoteNumber;
  await invoice.save();

  return creditNote;
}

module.exports = {
  createInvoiceForOrder,
  enqueueInvoiceJob,
  createCreditNoteForRefund,
};

