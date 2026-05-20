const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { requireAdmin, requireVendor } = require('../middleware/authorizationMiddleware');
const {
  denyEnumeration,
  invoiceReadLimiter,
  invoiceWriteLimiter,
  requireInvoiceAdminPermission,
} = require('../middleware/invoiceSecurityMiddleware');
const { validateQuery } = require('../validation/schemaValidator');
const { adminInvoiceQuerySchema, emailLogQuerySchema } = require('../validation/schemas/invoiceSchemas');
const {
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
} = require('../controllers/invoiceController');

const router = express.Router();

router.get('/verify/invoice/:invoiceId', verifyInvoicePublic);
router.post('/webhooks/resend', ingestEmailWebhook);

router.use(authMiddleware);
router.use(denyEnumeration);

router.post('/generate/:orderId', invoiceWriteLimiter, generateInvoice);
router.post('/queue/:orderId', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_queue'), queueInvoiceByOrder);
router.get('/my', invoiceReadLimiter, myInvoices);
router.get('/vendor', invoiceReadLimiter, requireVendor, vendorInvoices);

router.get('/admin/list', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_read'), validateQuery(adminInvoiceQuerySchema), listAdminInvoices);
router.get('/admin/export/csv', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_export'), validateQuery(adminInvoiceQuerySchema), exportAdminInvoicesCsv);
router.get('/admin/export/xlsx', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_export'), validateQuery(adminInvoiceQuerySchema), exportAdminInvoicesXlsx);
router.get('/admin/reports/gst', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_reports'), validateQuery(adminInvoiceQuerySchema), invoiceGstReport);
router.post('/admin/:invoiceId/regenerate', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_regenerate'), regenerateInvoice);
router.post('/admin/:invoiceId/cancel', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_cancel'), cancelInvoice);
router.get('/admin/email-logs', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_email_logs'), validateQuery(emailLogQuerySchema), listEmailLogs);
router.post('/admin/email-logs/:emailLogId/resend', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_email_resend'), resendEmailLog);
router.post('/admin/:invoiceId/credit-note', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_credit_note'), createCreditNote);
router.get('/admin/credit-notes', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_read'), listCreditNotes);
router.post('/admin/queue/replay-dlq', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_queue'), replayInvoiceDeadLetter);
router.post('/admin/queue/pause', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_queue'), pauseInvoiceQueueAdmin);
router.post('/admin/queue/resume', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_queue'), resumeInvoiceQueueAdmin);
router.get('/admin/replay-audit', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_read'), replayAuditLogs);
router.get('/admin/replay-dashboard', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_read'), replayDashboard);
router.get('/admin/suppressions', invoiceReadLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_email_logs'), listSuppressions);
router.post('/admin/suppressions', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_email_logs'), upsertSuppressionEntry);
router.patch('/admin/:invoiceId/freeze', invoiceWriteLimiter, requireAdmin, requireInvoiceAdminPermission('invoices_cancel'), freezeInvoice);

router.get('/download-link/:invoiceId', invoiceReadLimiter, getSignedInvoiceUrl);
router.get('/download/:invoiceId', invoiceReadLimiter, downloadInvoice);
router.post('/:invoiceId/email', invoiceWriteLimiter, emailInvoice);
router.get('/:invoiceId', invoiceReadLimiter, getInvoice);

module.exports = router;
