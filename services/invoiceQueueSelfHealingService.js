const { queueNames, queueMetrics, resumeQueue } = require('./bullMqService');
const logger = require('./structuredLogger');

let timer = null;

async function runSelfHealCycle() {
  try {
    const metrics = await queueMetrics();
    const stalledThreshold = Number(process.env.INVOICE_QUEUE_SELF_HEAL_FAILED_THRESHOLD || 500);
    for (const [name, stat] of Object.entries(metrics || {})) {
      if (!stat || typeof stat !== 'object') continue;
      const failed = Number(stat.failed || 0);
      const paused = Number(stat.paused || 0) > 0;
      if (paused && failed < stalledThreshold) {
        await resumeQueue(name);
        logger.warn('invoice_queue_auto_resumed', { module: 'invoiceQueueSelfHealingService', queueName: name, failed });
      }
    }
  } catch (error) {
    logger.error('invoice_queue_self_heal_cycle_failed', {
      module: 'invoiceQueueSelfHealingService',
      message: String(error?.message || error),
    });
  }
}

function startInvoiceQueueSelfHealing() {
  if (timer) return;
  if (String(process.env.INVOICE_QUEUE_SELF_HEAL_ENABLED || 'true').trim().toLowerCase() !== 'true') return;
  const intervalMs = Number(process.env.INVOICE_QUEUE_SELF_HEAL_INTERVAL_MS || 30000);
  timer = setInterval(runSelfHealCycle, intervalMs);
}

function stopInvoiceQueueSelfHealing() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

module.exports = {
  startInvoiceQueueSelfHealing,
  stopInvoiceQueueSelfHealing,
  runSelfHealCycle,
};
