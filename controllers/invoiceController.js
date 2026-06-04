const fs = require('fs');
const mongoose = require('mongoose');

const Invoice = require('../models/Invoice');
const CreditNote = require('../models/CreditNote');
const InvoiceEmailLog = require('../models/InvoiceEmailLog');
const Order = require('../models/Order');
const { hasRole } = require('../middleware/authorizationMiddleware');
const { buildSignedToken, verifySignedToken } = require('../services/invoiceSigningService');
const { resolvePdfPath, buildCloudinarySignedUrl } = require('../services/invoiceStorageService');
const { createInvoiceForOrder, enqueueInvoiceJob, createCreditNoteForRefund } = require('../services/invoiceService');
const { logInvoiceAudit } = require('../services/invoiceAuditService');
const { queueInvoiceEmailLog } = require('../services/invoiceNotificationService');
const {
  verifyResendWebhookSignature,
  processResendEvent,
  upsertSuppression,
} = require('../services/invoiceEmailLifecycleService');
const InvoiceEmailSuppression = require('../models/InvoiceEmailSuppression');
const InvoiceReplayAuditLog = require('../models/InvoiceReplayAuditLog');
const { pauseInvoiceQueue, resumeInvoiceQueue, replayInvoiceDlq } = require('../services/invoiceReplayOpsService');
const { queueNames } = require('../services/bullMqService');
const { queueMetrics } = require('../services/bullMqService');

function canAccessInvoice(req, invoice) {
  if (!invoice) return false;
  if (hasRole(req.user, ['admin', 'super_admin'])) return true;
  if (req.user?.uid && req.user.uid === invoice.customerId) return true;
  if (hasRole(req.user, ['vendor']) && req.user.uid === invoice.vendorId) return true;
  return false;
}

function notFoundMessage(res) {
  return res?.locals?.invoiceNotFoundMessage || 'Invoice not found.';
}

function requireReplayConfirmation(req) {
  const required = String(process.env.INVOICE_REPLAY_CONFIRMATION || 'CONFIRM_INVOICE_REPLAY').trim();
  const provided = String(req.body?.confirmation || req.headers['x-invoice-replay-confirmation'] || '').trim();
  return provided && provided === required;
}

function serializeInvoice(doc) {
  const source = doc?.toObject ? doc.toObject() : doc;
  if (!source) return null;
  return {
    id: String(source._id),
    invoiceNumber: source.invoiceNumber,
    orderId: String(source.orderId),
    customerId: source.customerId,
    vendorId: source.vendorId,
    items: source.items || [],
    subtotal: Number(source.subtotal || 0),
    discount: Number(source.discount || 0),
    tax: Number(source.tax || 0),
    cgst: Number(source.cgst || 0),
    sgst: Number(source.sgst || 0),
    igst: Number(source.igst || 0),
    shippingCharge: Number(source.shippingCharge || 0),
    grandTotal: Number(source.grandTotal || 0),
    paymentMethod: source.paymentMethod || '',
    paymentStatus: source.paymentStatus || '',
    billingAddress: source.billingAddress || {},
    shippingAddress: source.shippingAddress || {},
    invoicePdfUrl: source.invoicePdfUrl || '',
    cloudinaryAsset: source.cloudinaryAsset || {},
    generatedAt: source.generatedAt,
    status: source.status,
    versionLabel: source.versionLabel || 'v1',
    versionSequence: Number(source.versionSequence || 1),
    signedHash: source.signedHash || '',
    creditNoteNumber: source.creditNoteNumber || '',
    settlement: source.settlement || {},
  };
}

function buildCsvRow(cols) {
  return cols.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',');
}

function parseInvoiceFilters(query = {}) {
  const filter = {};
  if (query.paymentStatus) filter.paymentStatus = String(query.paymentStatus).trim();
  if (query.status) filter.status = String(query.status).trim();
  if (query.customerId) filter.customerId = String(query.customerId).trim();
  if (query.vendorId) filter.vendorId = String(query.vendorId).trim();
  if (query.orderId && mongoose.Types.ObjectId.isValid(query.orderId)) {
    filter.orderId = new mongoose.Types.ObjectId(String(query.orderId));
  }
  if (query.dateFrom || query.dateTo) {
    filter.generatedAt = {};
    if (query.dateFrom) filter.generatedAt.$gte = new Date(String(query.dateFrom));
    if (query.dateTo) filter.generatedAt.$lte = new Date(String(query.dateTo));
  }
  return filter;
}

async function generateInvoice(req, res, next) {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const isAdmin = hasRole(req.user, ['admin', 'super_admin']);
    if (!isAdmin && req.user?.uid !== order.userId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const invoice = await createInvoiceForOrder(orderId, {
      forceRegenerate: req.query.force === 'true' || req.body?.forceRegenerate === true,
    });
    await logInvoiceAudit({ req, action: 'generatedBy', invoiceId: invoice._id, payload: { orderId } });
    return res.status(200).json({ success: true, data: serializeInvoice(invoice) });
  } catch (error) {
    return next(error);
  }
}

async function getInvoice(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice id.' });
    }
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: notFoundMessage(res) });
    }
    if (!canAccessInvoice(req, invoice)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    await logInvoiceAudit({ req, action: 'viewedBy', invoiceId: invoice._id, payload: { invoiceNumber: invoice.invoiceNumber } });
    return res.status(200).json({ success: true, data: serializeInvoice(invoice) });
  } catch (error) {
    return next(error);
  }
}

async function myInvoices(req, res, next) {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const docs = await Invoice.find({ customerId: req.user.uid }).sort({ generatedAt: -1 }).limit(limit);
    return res.status(200).json({ success: true, data: docs.map(serializeInvoice) });
  } catch (error) {
    return next(error);
  }
}

async function getSignedInvoiceUrl(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: notFoundMessage(res) });
    }
    if (!canAccessInvoice(req, invoice)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const expiresAt = Date.now() + 10 * 60 * 1000;
    const token = buildSignedToken({
      invoiceId,
      userId: req.user.uid,
      role: req.user.role,
      version: invoice.versionLabel || 'v1',
      expiresAt,
    });

    const downloadPath = `/api/invoices/download/${invoiceId}?token=${encodeURIComponent(token)}`;
    const cloudUrl = invoice.cloudinaryAsset?.publicId
      ? buildCloudinarySignedUrl({ publicId: invoice.cloudinaryAsset.publicId, expiresInSeconds: 600 })
      : '';

    return res.status(200).json({
      success: true,
      data: {
        signedUrl: downloadPath,
        absoluteSignedUrl: `${process.env.PUBLIC_BACKEND_URL || ''}${downloadPath}`,
        cloudinarySignedUrl: cloudUrl,
        expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function downloadInvoice(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice id.' });
    }
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(401).json({ success: false, message: 'Signed token is required.' });
    }
    const verified = verifySignedToken(token);
    if (!verified.valid || verified.invoiceId !== invoiceId) {
      return res.status(401).json({ success: false, message: 'Invalid or expired signed token.' });
    }

    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: notFoundMessage(res) });
    }

    const tokenUser = String(verified.userId || '');
    const tokenRole = String(verified.role || '');
    const allowedByToken = tokenUser === invoice.customerId || tokenUser === invoice.vendorId || tokenRole === 'admin' || tokenRole === 'super_admin';
    if (!allowedByToken) {
      return res.status(403).json({ success: false, message: 'Token/user mismatch for invoice access.' });
    }

    const filePath = resolvePdfPath(invoice.invoiceNumber, invoice.versionLabel || 'v1');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Invoice PDF not found on storage.' });
    }

    invoice.lastDownloadedAt = new Date();
    await invoice.save();
    await logInvoiceAudit({
      req,
      action: 'downloadedBy',
      invoiceId: invoice._id,
      payload: { tokenRole, tokenUser, version: invoice.versionLabel || 'v1' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber}-${invoice.versionLabel || 'v1'}.pdf"`);
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    return next(error);
  }
}

async function listAdminInvoices(req, res, next) {
  try {
    const query = parseInvoiceFilters(req.query);
    const limit = Math.min(300, Math.max(1, Number(req.query.limit || 50)));
    const page = Math.max(1, Number(req.query.page || 1));
    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      Invoice.find(query).sort({ generatedAt: -1 }).skip(skip).limit(limit),
      Invoice.countDocuments(query),
    ]);
    return res.status(200).json({
      success: true,
      data: rows.map(serializeInvoice),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    return next(error);
  }
}

async function exportAdminInvoicesCsv(req, res, next) {
  try {
    const query = parseInvoiceFilters(req.query);
    const invoices = await Invoice.find(query).sort({ generatedAt: -1 }).limit(10000);
    const lines = [
      buildCsvRow(['invoiceNumber', 'orderId', 'customerId', 'vendorId', 'paymentStatus', 'status', 'subtotal', 'cgst', 'sgst', 'igst', 'tax', 'grandTotal', 'generatedAt']),
      ...invoices.map((row) => buildCsvRow([
        row.invoiceNumber,
        row.orderId,
        row.customerId,
        row.vendorId,
        row.paymentStatus,
        row.status,
        row.subtotal,
        row.cgst,
        row.sgst,
        row.igst,
        row.tax,
        row.grandTotal,
        row.generatedAt?.toISOString?.() || '',
      ])),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="abianzo-invoices.csv"');
    return res.status(200).send(lines.join('\n'));
  } catch (error) {
    return next(error);
  }
}

async function exportAdminInvoicesXlsx(req, res, next) {
  try {
    let ExcelJS;
    try {
      // Lazy-load so core APIs still boot if dependency is not installed yet.
      // eslint-disable-next-line global-require
      ExcelJS = require('exceljs');
    } catch (_) {
      return res.status(500).json({
        success: false,
        message: 'XLSX export dependency missing. Install exceljs in backend.',
      });
    }
    const query = parseInvoiceFilters(req.query);
    const rows = await Invoice.find(query).sort({ generatedAt: -1 }).limit(10000);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Invoices');
    sheet.columns = [
      { header: 'Invoice Number', key: 'invoiceNumber', width: 22 },
      { header: 'Order ID', key: 'orderId', width: 28 },
      { header: 'Customer ID', key: 'customerId', width: 24 },
      { header: 'Vendor ID', key: 'vendorId', width: 24 },
      { header: 'Payment Status', key: 'paymentStatus', width: 16 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'CGST', key: 'cgst', width: 14 },
      { header: 'SGST', key: 'sgst', width: 14 },
      { header: 'IGST', key: 'igst', width: 14 },
      { header: 'Tax', key: 'tax', width: 14 },
      { header: 'Grand Total', key: 'grandTotal', width: 16 },
      { header: 'Generated At', key: 'generatedAt', width: 24 },
    ];

    rows.forEach((r) => {
      sheet.addRow({
        invoiceNumber: r.invoiceNumber,
        orderId: String(r.orderId),
        customerId: r.customerId,
        vendorId: r.vendorId,
        paymentStatus: r.paymentStatus,
        status: r.status,
        subtotal: r.subtotal,
        cgst: r.cgst,
        sgst: r.sgst,
        igst: r.igst,
        tax: r.tax,
        grandTotal: r.grandTotal,
        generatedAt: r.generatedAt?.toISOString?.() || '',
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="abianzo-invoices.xlsx"');
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return next(error);
  }
}

async function cancelInvoice(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: notFoundMessage(res) });
    }
    invoice.status = 'cancelled';
    await invoice.save();
    await logInvoiceAudit({ req, action: 'cancelledBy', invoiceId: invoice._id, payload: { invoiceNumber: invoice.invoiceNumber } });
    return res.status(200).json({ success: true, data: serializeInvoice(invoice) });
  } catch (error) {
    return next(error);
  }
}

async function regenerateInvoice(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const existing = await Invoice.findById(invoiceId);
    if (!existing) {
      return res.status(404).json({ success: false, message: notFoundMessage(res) });
    }
    const invoice = await createInvoiceForOrder(existing.orderId.toString(), { forceRegenerate: true });
    await logInvoiceAudit({ req, action: 'regeneratedBy', invoiceId: invoice._id, payload: { previousInvoiceId: invoiceId } });
    return res.status(200).json({ success: true, data: serializeInvoice(invoice) });
  } catch (error) {
    return next(error);
  }
}

async function invoiceGstReport(req, res, next) {
  try {
    const query = parseInvoiceFilters(req.query);
    query.status = { $ne: 'cancelled' };
    const rows = await Invoice.find(query).sort({ generatedAt: -1 }).limit(10000);

    const summary = rows.reduce((acc, row) => {
      acc.invoices += 1;
      acc.taxable += Number(row.subtotal || 0);
      acc.cgst += Number(row.cgst || 0);
      acc.sgst += Number(row.sgst || 0);
      acc.igst += Number(row.igst || 0);
      acc.tax += Number(row.tax || 0);
      acc.total += Number(row.grandTotal || 0);
      if (row.status === 'refunded' || row.status === 'partially_refunded') {
        acc.refunds += Number(row.grandTotal || 0);
      }
      return acc;
    }, { invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0, refunds: 0 });

    const byState = {};
    rows.forEach((row) => {
      const state = String(row.shippingAddress?.state || 'UNKNOWN').toUpperCase();
      if (!byState[state]) {
        byState[state] = { invoices: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total: 0 };
      }
      byState[state].invoices += 1;
      byState[state].taxable += Number(row.subtotal || 0);
      byState[state].cgst += Number(row.cgst || 0);
      byState[state].sgst += Number(row.sgst || 0);
      byState[state].igst += Number(row.igst || 0);
      byState[state].tax += Number(row.tax || 0);
      byState[state].total += Number(row.grandTotal || 0);
    });

    const hsnSacSummary = {};
    rows.forEach((row) => {
      (row.items || []).forEach((item) => {
        const key = String(item.hsnSac || 'UNSPECIFIED').trim().toUpperCase() || 'UNSPECIFIED';
        if (!hsnSacSummary[key]) {
          hsnSacSummary[key] = {
            taxableValue: 0,
            tax: 0,
            cgst: 0,
            sgst: 0,
            igst: 0,
            quantity: 0,
          };
        }
        hsnSacSummary[key].taxableValue += Number(item.taxableValue || 0);
        hsnSacSummary[key].tax += Number(item.cgstAmount || 0) + Number(item.sgstAmount || 0) + Number(item.igstAmount || 0);
        hsnSacSummary[key].cgst += Number(item.cgstAmount || 0);
        hsnSacSummary[key].sgst += Number(item.sgstAmount || 0);
        hsnSacSummary[key].igst += Number(item.igstAmount || 0);
        hsnSacSummary[key].quantity += Number(item.quantity || 0);
      });
    });

    const invoiceSequence = rows
      .map((row) => String(row.invoiceNumber || ''))
      .filter(Boolean)
      .sort();
    let sequenceGapCount = 0;
    for (let i = 1; i < invoiceSequence.length; i += 1) {
      const prev = Number(invoiceSequence[i - 1].split('-').pop() || 0);
      const curr = Number(invoiceSequence[i].split('-').pop() || 0);
      if (Number.isFinite(prev) && Number.isFinite(curr) && curr - prev > 1) {
        sequenceGapCount += 1;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        summary,
        stateWise: byState,
        hsnSacSummary,
        compliance: {
          sequenceGapCount,
          roundingMode: 'HALF_UP_2_DECIMALS',
          gstReversalOnRefund: true,
        },
        gstr1Summary: {
          b2cInvoices: summary.invoices,
          taxableValue: summary.taxable,
          totalTax: summary.tax,
        },
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function vendorInvoices(req, res, next) {
  try {
    const docs = await Invoice.find({ vendorId: req.user.uid }).sort({ generatedAt: -1 }).limit(200);
    return res.status(200).json({ success: true, data: docs.map(serializeInvoice) });
  } catch (error) {
    return next(error);
  }
}

async function queueInvoiceByOrder(req, res, next) {
  try {
    const orderId = String(req.params.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    const job = await enqueueInvoiceJob(orderId, 'manual_queue');
    return res.status(202).json({ success: true, data: job });
  } catch (error) {
    return next(error);
  }
}

async function emailInvoice(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, message: notFoundMessage(res) });
    }
    if (!canAccessInvoice(req, invoice)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const token = buildSignedToken({
      invoiceId,
      userId: invoice.customerId,
      role: 'customer',
      version: invoice.versionLabel || 'v1',
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    const signedUrl = `${process.env.PUBLIC_BACKEND_URL || ''}/api/invoices/download/${invoiceId}?token=${encodeURIComponent(token)}`;

    const log = await queueInvoiceEmailLog({
      invoice,
      customerEmail: req.body?.email || req.user?.email || '',
      signedUrl,
      subjectPrefix: 'Abianzo Invoice',
    });

    invoice.emailedAt = new Date();
    await invoice.save();
    await logInvoiceAudit({ req, action: 'emailedBy', invoiceId: invoice._id, payload: { emailLogId: String(log?._id || '') } });
    return res.status(200).json({ success: true, message: 'Invoice email queued.', data: { emailLogId: String(log?._id || '') } });
  } catch (error) {
    return next(error);
  }
}

async function listEmailLogs(req, res, next) {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const query = {};
    if (req.query.status) query.status = String(req.query.status).trim();
    if (req.query.invoiceId && mongoose.Types.ObjectId.isValid(req.query.invoiceId)) {
      query.invoiceId = new mongoose.Types.ObjectId(String(req.query.invoiceId));
    }
    const rows = await InvoiceEmailLog.find(query).sort({ createdAt: -1 }).limit(limit);
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
}

async function resendEmailLog(req, res, next) {
  try {
    const id = String(req.params.emailLogId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: 'Invalid email log id.' });
    }
    const log = await InvoiceEmailLog.findById(id);
    if (!log) {
      return res.status(404).json({ success: false, message: 'Email log not found.' });
    }
    log.status = 'queued';
    log.nextRetryAt = new Date();
    await log.save();
    const { queueInvoiceEmail } = require('../services/invoiceBullMqOrchestrator');
    await queueInvoiceEmail(String(log._id));
    return res.status(202).json({ success: true, data: { emailLogId: id, status: 'queued' } });
  } catch (error) {
    return next(error);
  }
}

async function createCreditNote(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice id.' });
    }
    const creditNote = await createCreditNoteForRefund({
      invoiceId,
      reason: String(req.body?.reason || 'refund').trim(),
      refundType: String(req.body?.refundType || 'full').trim(),
      lines: Array.isArray(req.body?.lines) ? req.body.lines : [],
      paymentGatewayRefundId: String(req.body?.paymentGatewayRefundId || '').trim(),
      refundTransactionId: String(req.body?.refundTransactionId || '').trim(),
    });
    await logInvoiceAudit({ req, action: 'creditNoteGenerated', creditNoteId: creditNote._id, invoiceId: creditNote.invoiceId });
    return res.status(201).json({ success: true, data: creditNote });
  } catch (error) {
    return next(error);
  }
}

async function listCreditNotes(req, res, next) {
  try {
    const query = {};
    if (req.query.invoiceId && mongoose.Types.ObjectId.isValid(req.query.invoiceId)) {
      query.invoiceId = new mongoose.Types.ObjectId(String(req.query.invoiceId));
    }
    if (req.query.customerId) query.customerId = String(req.query.customerId).trim();
    const rows = await CreditNote.find(query).sort({ createdAt: -1 }).limit(Math.min(500, Number(req.query.limit || 100)));
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
}

async function verifyInvoicePublic(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(400).json({ success: false, message: 'Invalid invoice id.' });
    }
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ success: false, valid: false, message: 'Invoice not found.' });
    }
    const expectedHash = require('../services/invoiceNumberService').buildInvoiceSnapshotHash(invoice.immutableSnapshot || {});
    const valid = expectedHash === invoice.signedHash;
    const safe = {
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status,
      generatedAt: invoice.generatedAt,
      grandTotal: invoice.grandTotal,
    };
    const qrHash = String(req.query.hash || '').trim();
    const qrVerified = qrHash ? qrHash === invoice.signedHash : true;
    return res.status(200).json({ success: true, valid: valid && qrVerified, data: safe, hashVerified: valid, qrVerified });
  } catch (error) {
    return next(error);
  }
}

async function ingestEmailWebhook(req, res, next) {
  try {
    const rawBody = JSON.stringify(req.body || {});
    const signature = req.headers['x-resend-signature'] || req.headers['x-webhook-signature'] || '';
    if (!verifyResendWebhookSignature(rawBody, signature)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
    }
    const event = req.body || {};
    const result = await processResendEvent({ event, reqLike: req });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function listSuppressions(req, res, next) {
  try {
    const rows = await InvoiceEmailSuppression.find({})
      .sort({ updatedAt: -1 })
      .limit(Math.min(1000, Math.max(1, Number(req.query.limit || 200))));
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
}

async function upsertSuppressionEntry(req, res, next) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ success: false, message: 'email is required.' });
    const row = await upsertSuppression({
      email,
      reason: String(req.body?.reason || 'manual').trim(),
      providerMessageId: String(req.body?.providerMessageId || '').trim(),
      notes: String(req.body?.notes || '').trim(),
    });
    return res.status(200).json({ success: true, data: row });
  } catch (error) {
    return next(error);
  }
}

async function replayInvoiceDeadLetter(req, res, next) {
  try {
    if (!requireReplayConfirmation(req)) {
      return res.status(400).json({ success: false, message: 'Replay confirmation missing/invalid.' });
    }
    const limit = Math.min(200, Math.max(1, Number(req.body?.limit || 25)));
    const result = await replayInvoiceDlq(req, { limit });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function pauseInvoiceQueueAdmin(req, res, next) {
  try {
    if (!requireReplayConfirmation(req)) {
      return res.status(400).json({ success: false, message: 'Replay confirmation missing/invalid.' });
    }
    const queueName = String(req.body?.queueName || queueNames.emailSending).trim();
    const data = await pauseInvoiceQueue(req, queueName);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function resumeInvoiceQueueAdmin(req, res, next) {
  try {
    if (!requireReplayConfirmation(req)) {
      return res.status(400).json({ success: false, message: 'Replay confirmation missing/invalid.' });
    }
    const queueName = String(req.body?.queueName || queueNames.emailSending).trim();
    const data = await resumeInvoiceQueue(req, queueName);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function replayAuditLogs(req, res, next) {
  try {
    const rows = await InvoiceReplayAuditLog.find({})
      .sort({ createdAt: -1 })
      .limit(Math.min(1000, Math.max(1, Number(req.query.limit || 200))));
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
}

async function replayDashboard(req, res, next) {
  try {
    const [metrics, latestAudits] = await Promise.all([
      queueMetrics(),
      InvoiceReplayAuditLog.find({}).sort({ createdAt: -1 }).limit(50),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        queues: metrics,
        replayAudit: latestAudits,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function freezeInvoice(req, res, next) {
  try {
    const invoiceId = String(req.params.invoiceId || '').trim();
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) return res.status(404).json({ success: false, message: notFoundMessage(res) });
    invoice.freezeState = String(req.body?.freezeState || 'frozen').trim();
    invoice.legalHold = req.body?.legalHold === true;
    invoice.retentionUntil = req.body?.retentionUntil ? new Date(req.body.retentionUntil) : invoice.retentionUntil;
    await invoice.save();
    await logInvoiceAudit({ req, action: 'freezeUpdated', invoiceId: invoice._id, payload: { freezeState: invoice.freezeState, legalHold: invoice.legalHold } });
    return res.status(200).json({ success: true, data: serializeInvoice(invoice) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  generateInvoice,
  getInvoice,
  myInvoices,
  downloadInvoice,
  getSignedInvoiceUrl,
  listAdminInvoices,
  exportAdminInvoicesCsv,
  exportAdminInvoicesXlsx,
  cancelInvoice,
  regenerateInvoice,
  invoiceGstReport,
  vendorInvoices,
  queueInvoiceByOrder,
  emailInvoice,
  listEmailLogs,
  resendEmailLog,
  createCreditNote,
  listCreditNotes,
  verifyInvoicePublic,
  ingestEmailWebhook,
  listSuppressions,
  upsertSuppressionEntry,
  replayInvoiceDeadLetter,
  pauseInvoiceQueueAdmin,
  resumeInvoiceQueueAdmin,
  replayAuditLogs,
  freezeInvoice,
  replayDashboard,
};
