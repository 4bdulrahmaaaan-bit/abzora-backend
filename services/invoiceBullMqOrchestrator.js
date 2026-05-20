const { queueNames, addJob, registerWorker, workerStats } = require('./bullMqService');
const { createInvoiceForOrder } = require('./invoiceService');
const InvoiceEmailLog = require('../models/InvoiceEmailLog');
const Invoice = require('../models/Invoice');

let started = false;

async function startInvoiceBullMqWorkers() {
  if (started) return;
  started = true;

  await registerWorker(queueNames.invoiceGeneration, async (job) => {
    const { orderId, forceRegenerate = false } = job.data || {};
    if (!orderId) return null;
    if (!forceRegenerate) {
      const existing = await Invoice.findOne({ orderId, status: { $ne: 'cancelled' } }).select('_id invoiceNumber');
      if (existing) {
        return { deduped: true, invoiceId: String(existing._id), invoiceNumber: existing.invoiceNumber };
      }
    }
    return createInvoiceForOrder(orderId, { forceRegenerate });
  }, { concurrency: Number(process.env.INVOICE_GEN_WORKER_CONCURRENCY || 4) });

  await registerWorker(queueNames.emailSending, async (job) => {
    const { emailLogId } = job.data || {};
    if (!emailLogId) return null;
    const log = await InvoiceEmailLog.findById(emailLogId);
    if (!log) return null;
    try {
      const { sendInvoiceEmail } = require('./invoiceNotificationService');
      await sendInvoiceEmail({
        invoice: { _id: log.invoiceId, invoiceNumber: log.payload?.invoiceNumber || '' },
        customerEmail: log.email,
        subject: log.subject,
        html: log.payload?.html || '',
        signedUrl: log.payload?.signedUrl || '',
      });
      log.status = 'sent';
      log.providerMessageId = log.providerMessageId || `queued-${Date.now()}`;
      log.lastError = '';
    } catch (error) {
      log.status = 'failed';
      log.lastError = String(error.message || error);
      log.nextRetryAt = new Date(Date.now() + 60000 * Math.max(1, log.attempts || 1));
      workerStats[queueNames.emailSending].retriesScheduled += 1;
      await addJob(queueNames.emailSending, 'invoice-email-retry', { emailLogId }, {
        delay: 30000,
        attempts: 5,
      });
      if ((job.attemptsMade || 0) >= Number(process.env.INVOICE_EMAIL_DLQ_ATTEMPTS || 5)) {
        await addJob(queueNames.deadLetter, 'invoice-email-dead-letter', {
          sourceQueue: queueNames.emailSending,
          emailLogId,
          failedAt: new Date().toISOString(),
          reason: log.lastError,
        }, {
          attempts: 1,
          removeOnComplete: 2000,
          removeOnFail: 2000,
        });
      }
    }
    log.attempts = Number(log.attempts || 0) + 1;
    await log.save();
    return log.status;
  }, { concurrency: Number(process.env.INVOICE_EMAIL_WORKER_CONCURRENCY || 3) });

  await registerWorker(queueNames.deadLetter, async (job) => job.data || {}, {
    concurrency: Number(process.env.INVOICE_DLQ_WORKER_CONCURRENCY || 1),
  });
}

async function queueInvoiceGeneration(orderId, options = {}) {
  return addJob(queueNames.invoiceGeneration, 'generate-invoice', { orderId, ...options }, {
    jobId: `inv-${orderId}`,
    attempts: 8,
  });
}

async function queueInvoiceEmail(emailLogId) {
  return addJob(queueNames.emailSending, 'send-invoice-email', { emailLogId }, {
    jobId: `inv-email-${emailLogId}`,
    attempts: 6,
  });
}

module.exports = {
  startInvoiceBullMqWorkers,
  queueInvoiceGeneration,
  queueInvoiceEmail,
};
