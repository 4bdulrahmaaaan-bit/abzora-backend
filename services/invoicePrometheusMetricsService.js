const Invoice = require('../models/Invoice');
const InvoiceEmailLog = require('../models/InvoiceEmailLog');
const InvoiceEmailSuppression = require('../models/InvoiceEmailSuppression');
const { queueMetrics } = require('./bullMqService');

async function renderInvoicePrometheusMetrics() {
  const [invoiceTotal, emailFailed, emailSent, suppressions, queues] = await Promise.all([
    Invoice.countDocuments({}),
    InvoiceEmailLog.countDocuments({ status: 'failed' }),
    InvoiceEmailLog.countDocuments({ status: { $in: ['sent', 'delivered'] } }),
    InvoiceEmailSuppression.countDocuments({ active: true }),
    queueMetrics(),
  ]);
  const lines = [];
  lines.push('# HELP abzora_invoice_total Total invoices in system');
  lines.push('# TYPE abzora_invoice_total gauge');
  lines.push(`abzora_invoice_total ${invoiceTotal}`);
  lines.push('# HELP abzora_invoice_email_failed_total Failed invoice email logs');
  lines.push('# TYPE abzora_invoice_email_failed_total counter');
  lines.push(`abzora_invoice_email_failed_total ${emailFailed}`);
  lines.push('# HELP abzora_invoice_email_sent_total Sent/delivered invoice email logs');
  lines.push('# TYPE abzora_invoice_email_sent_total counter');
  lines.push(`abzora_invoice_email_sent_total ${emailSent}`);
  lines.push('# HELP abzora_invoice_email_suppressions_active Active suppressed recipients');
  lines.push('# TYPE abzora_invoice_email_suppressions_active gauge');
  lines.push(`abzora_invoice_email_suppressions_active ${suppressions}`);
  Object.entries(queues || {}).forEach(([queue, stat]) => {
    if (stat && typeof stat.failed === 'number') {
      lines.push(`abzora_invoice_queue_failed{queue="${queue}"} ${stat.failed}`);
      lines.push(`abzora_invoice_queue_waiting{queue="${queue}"} ${Number(stat.waiting || 0)}`);
      lines.push(`abzora_invoice_queue_active{queue="${queue}"} ${Number(stat.active || 0)}`);
    }
  });
  return `${lines.join('\n')}\n`;
}

module.exports = {
  renderInvoicePrometheusMetrics,
};
