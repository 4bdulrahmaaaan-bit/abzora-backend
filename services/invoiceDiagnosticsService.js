const Invoice = require('../models/Invoice');
const InvoiceEmailLog = require('../models/InvoiceEmailLog');
const { queueMetrics } = require('./bullMqService');
const { scanInvoiceStorageAnomalies } = require('./invoiceCloudinaryLifecycleService');

async function getInvoiceHealth() {
  const [total, generated, cancelled, refunded] = await Promise.all([
    Invoice.countDocuments({}),
    Invoice.countDocuments({ status: 'generated' }),
    Invoice.countDocuments({ status: 'cancelled' }),
    Invoice.countDocuments({ status: { $in: ['refunded', 'partially_refunded'] } }),
  ]);
  return {
    total,
    generated,
    cancelled,
    refunded,
    status: 'ok',
  };
}

async function getStorageHealth() {
  const provider = String(process.env.INVOICE_STORAGE_PROVIDER || 'local').trim().toLowerCase();
  const cloudinaryConfigured = Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
  const rows = await Invoice.find({}).sort({ createdAt: -1 }).limit(50).select('cloudinaryAsset');
  const anomalyScan = await scanInvoiceStorageAnomalies();
  const withChecksum = rows.filter((row) => String(row.cloudinaryAsset?.checksum || '').length > 10).length;
  return {
    provider,
    cloudinaryConfigured,
    recentChecksumCoverage: rows.length ? Number((withChecksum / rows.length).toFixed(2)) : 1,
    anomalyCount: anomalyScan.anomalyCount,
    status: provider === 'cloudinary' && !cloudinaryConfigured ? 'degraded' : 'ok',
  };
}

async function getEmailHealth() {
  const [queued, sent, failed] = await Promise.all([
    InvoiceEmailLog.countDocuments({ status: 'queued' }),
    InvoiceEmailLog.countDocuments({ status: 'sent' }),
    InvoiceEmailLog.countDocuments({ status: 'failed' }),
  ]);
  return {
    provider: process.env.RESEND_API_KEY ? 'resend' : 'stub',
    queued,
    sent,
    failed,
    status: failed > sent * 0.5 && failed > 10 ? 'degraded' : 'ok',
  };
}

async function getQueueHealth() {
  return queueMetrics();
}

module.exports = {
  getInvoiceHealth,
  getStorageHealth,
  getEmailHealth,
  getQueueHealth,
};
