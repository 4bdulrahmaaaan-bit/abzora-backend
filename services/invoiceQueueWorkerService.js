const InvoiceJob = require('../models/InvoiceJob');
const { createInvoiceForOrder } = require('./invoiceService');

let timer = null;
let running = false;

async function processOne() {
  const now = new Date();
  const job = await InvoiceJob.findOneAndUpdate(
    { status: 'queued', runAfter: { $lte: now } },
    { $set: { status: 'processing' }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true },
  );
  if (!job) {
    return;
  }

  try {
    const invoice = await createInvoiceForOrder(job.orderId.toString());
    job.status = 'done';
    job.invoiceId = invoice._id;
    job.lastError = '';
    await job.save();
  } catch (error) {
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || 5);
    job.lastError = String(error.message || error);
    if (attempts >= maxAttempts) {
      job.status = 'failed';
    } else {
      job.status = 'queued';
      job.runAfter = new Date(Date.now() + attempts * 30000);
    }
    await job.save();
  }
}

function startInvoiceQueueWorker(options = {}) {
  if (timer) {
    return;
  }
  const intervalMs = Number(options.intervalMs || process.env.INVOICE_QUEUE_INTERVAL_MS || 5000);
  timer = setInterval(async () => {
    if (running) {
      return;
    }
    running = true;
    try {
      await processOne();
    } finally {
      running = false;
    }
  }, intervalMs);
}

function stopInvoiceQueueWorker() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function getInvoiceQueueWorkerStatus() {
  return {
    running: Boolean(timer),
    busy: running,
  };
}

module.exports = {
  startInvoiceQueueWorker,
  stopInvoiceQueueWorker,
  getInvoiceQueueWorkerStatus,
};
