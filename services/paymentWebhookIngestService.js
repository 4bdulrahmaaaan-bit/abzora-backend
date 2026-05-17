const crypto = require('crypto');
const os = require('os');

const PaymentWebhookIngestEvent = require('../models/PaymentWebhookIngestEvent');
const { logSecurityEvent, logSecurityWarning, logSecurityError } = require('./auditLogger');
const telemetry = require('./telemetryContext');
const metricsTelemetry = require('./telemetryMetrics');

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function buildIngestId(source, eventId) {
  return `${source}:${eventId}:${nowMs()}:${crypto.randomBytes(4).toString('hex')}`;
}

function hashPayload(rawBody) {
  return crypto
    .createHash('sha256')
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || '')))
    .digest('hex');
}

function jitterMs(max) {
  return Math.floor(Math.random() * Math.max(1, Number(max || 0)));
}

function backoffMs(attempt) {
  const base = 1000;
  const cap = 5 * 60 * 1000;
  const exp = Math.min(cap, base * (2 ** Math.max(0, attempt - 1)));
  return exp + jitterMs(Math.floor(exp * 0.2));
}

function workerId() {
  return `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
}

async function persistWebhookIngestEvent({
  source,
  event,
  eventId,
  rawBody,
  payload,
  metadata = {},
}) {
  const context = telemetry.getContext();
  const ingestId = buildIngestId(source, eventId);
  try {
    await PaymentWebhookIngestEvent.create({
      ingestId,
      source,
      event,
      eventId: String(eventId || '').trim(),
      payloadHash: hashPayload(rawBody),
      payload,
      metadata: Object.fromEntries(Object.entries({
        ...metadata,
        traceId: context.traceId || '',
        spanId: context.spanId || '',
        requestId: context.requestId || '',
      }).map(([k, v]) => [k, String(v ?? '')])),
    });
    return { ingestId, duplicate: false };
  } catch (error) {
    if (error?.code === 11000) {
      return { ingestId: '', duplicate: true };
    }
    throw error;
  }
}

function createIngestMetrics() {
  return {
    claimed: 0,
    processed: 0,
    retriesScheduled: 0,
    deadLettered: 0,
    noWorkPolls: 0,
    lockLost: 0,
    heartbeatRenewals: 0,
    queueLagSamples: 0,
    queueLagMsTotal: 0,
  };
}

function createPaymentWebhookIngestWorker(options = {}) {
  const id = options.workerId || workerId();
  const pollIntervalMs = Math.max(250, Number(options.pollIntervalMs || 500));
  const batchSize = Math.max(1, Number(options.batchSize || 20));
  const leaseMs = Math.max(3000, Number(options.leaseMs || 15000));
  const maxAttemptsDefault = Math.max(1, Number(options.maxAttemptsDefault || 8));
  const cleanupEveryMs = Math.max(60000, Number(options.cleanupEveryMs || 10 * 60 * 1000));
  const retentionMs = Math.max(60000, Number(options.retentionMs || 2 * 24 * 60 * 60 * 1000));
  const workerConcurrency = Math.max(1, Number(options.concurrency || 6));
  const processor = options.processor;
  if (typeof processor !== 'function') {
    throw new Error('payment webhook ingest worker requires a processor function.');
  }

  const metrics = createIngestMetrics();
  let running = false;
  let pollTimer = null;
  let cleanupTimer = null;
  let lastTickAt = 0;
  let lastTickError = '';
  let lastTickErrorAt = 0;

  async function claimOne() {
    const now = new Date();
    const claimed = await PaymentWebhookIngestEvent.findOneAndUpdate(
      {
        status: { $in: ['pending', 'failed'] },
        deadLetter: { $ne: true },
        attempts: { $lt: maxAttemptsDefault },
        $and: [
          { $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
          { $or: [{ lockExpiresAt: { $exists: false } }, { lockExpiresAt: null }, { lockExpiresAt: { $lte: now } }] },
        ],
      },
      {
        $set: {
          status: 'processing',
          lockedBy: id,
          processingStartedAt: now,
          heartbeatAt: now,
          lockExpiresAt: new Date(now.getTime() + leaseMs),
        },
        $inc: { attempts: 1 },
      },
      { new: true, sort: { nextAttemptAt: 1, createdAt: 1 } },
    );
    if (claimed) {
      metrics.claimed += 1;
      metrics.queueLagSamples += 1;
      metrics.queueLagMsTotal += Math.max(0, nowMs() - new Date(claimed.createdAt).getTime());
    }
    return claimed;
  }

  async function heartbeat(eventDoc) {
    const now = new Date();
    const updated = await PaymentWebhookIngestEvent.updateOne(
      { _id: eventDoc._id, status: 'processing', lockedBy: id },
      { $set: { heartbeatAt: now, lockExpiresAt: new Date(now.getTime() + leaseMs) } },
    );
    if (updated.modifiedCount === 1) {
      metrics.heartbeatRenewals += 1;
      return true;
    }
    metrics.lockLost += 1;
    return false;
  }

  async function markProcessed(eventDoc) {
    await PaymentWebhookIngestEvent.updateOne(
      { _id: eventDoc._id, status: 'processing', lockedBy: id },
      {
        $set: {
          status: 'processed',
          deadLetter: false,
          deadLetterReason: '',
          lastError: '',
          lastErrorAt: null,
          processedAtIso: nowIso(),
          lockExpiresAt: null,
          lockedBy: '',
          heartbeatAt: null,
          processingStartedAt: null,
          nextAttemptAt: new Date(),
        },
      },
    );
    metrics.processed += 1;
  }

  async function markRetry(eventDoc, error) {
    const attempts = Number(eventDoc.attempts || 0);
    const maxAttempts = Number(eventDoc.maxAttempts || maxAttemptsDefault);
    const exhausted = attempts >= maxAttempts;
    const retryAt = new Date(nowMs() + backoffMs(attempts || 1));
    if (exhausted) {
      await PaymentWebhookIngestEvent.updateOne(
        { _id: eventDoc._id, lockedBy: id },
        {
          $set: {
            status: 'failed',
            deadLetter: true,
            deadLetterReason: `retry_exhausted:${String(error?.message || error)}`,
            lastError: String(error?.message || error),
            lastErrorAt: new Date(),
            lockExpiresAt: null,
            lockedBy: '',
            heartbeatAt: null,
            processingStartedAt: null,
            nextAttemptAt: retryAt,
          },
        },
      );
      metrics.deadLettered += 1;
      return;
    }
    await PaymentWebhookIngestEvent.updateOne(
      { _id: eventDoc._id, lockedBy: id },
      {
        $set: {
          status: 'failed',
          deadLetter: false,
          lastError: String(error?.message || error),
          lastErrorAt: new Date(),
          lockExpiresAt: null,
          lockedBy: '',
          heartbeatAt: null,
          processingStartedAt: null,
          nextAttemptAt: retryAt,
        },
      },
    );
    metrics.retriesScheduled += 1;
  }

  async function processOne(eventDoc) {
    const traceContext = telemetry.extractContext({
      traceContext: {
        traceId: eventDoc?.metadata?.get?.('traceId') || eventDoc?.metadata?.traceId || '',
        spanId: eventDoc?.metadata?.get?.('spanId') || eventDoc?.metadata?.spanId || '',
        requestId: eventDoc?.metadata?.get?.('requestId') || eventDoc?.metadata?.requestId || '',
      },
    });
    return telemetry.runWithContext(
      telemetry.createChildContext(traceContext || {}, {
        operation: 'payment_webhook_ingest_process',
        workerId: id,
        module: 'paymentWebhookIngestService',
        jobId: String(eventDoc?.ingestId || ''),
      }),
      async () => {
        const opStart = nowMs();
        try {
      if (!(await heartbeat(eventDoc))) {
        throw new Error('ingest_lock_lost');
      }
      await processor(eventDoc);
      if (!(await heartbeat(eventDoc))) {
        throw new Error('ingest_lock_lost');
      }
      await markProcessed(eventDoc);
          metricsTelemetry.observe('webhook_ingest_latency_ms', nowMs() - opStart, { event: eventDoc.event || 'unknown' });
    } catch (error) {
      await markRetry(eventDoc, error);
      logSecurityWarning('payment_webhook_ingest_retry', {
        workerId: id,
        ingestId: eventDoc.ingestId,
        webhookEvent: eventDoc.event,
        message: String(error?.message || error),
      });
          metricsTelemetry.inc('webhook_ingest_retry_total', 1, { event: eventDoc.event || 'unknown' });
    }
      },
    );
  }

  async function processBatch() {
    const claimed = [];
    for (let i = 0; i < batchSize; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const eventDoc = await claimOne();
      if (!eventDoc) break;
      claimed.push(eventDoc);
    }
    if (!claimed.length) {
      metrics.noWorkPolls += 1;
      return 0;
    }

    let index = 0;
    const workers = new Array(Math.min(workerConcurrency, claimed.length)).fill(0).map(async () => {
      while (index < claimed.length) {
        // eslint-disable-next-line no-plusplus
        const current = claimed[index++];
        // eslint-disable-next-line no-await-in-loop
        await processOne(current);
      }
    });
    await Promise.all(workers);
    return claimed.length;
  }

  async function cleanupProcessed() {
    const cutoff = new Date(nowMs() - retentionMs);
    const result = await PaymentWebhookIngestEvent.deleteMany({
      status: 'processed',
      updatedAt: { $lt: cutoff },
    });
    if (result.deletedCount > 0) {
      logSecurityEvent('payment_webhook_ingest_cleanup', {
        workerId: id,
        deletedCount: result.deletedCount,
      });
    }
  }

  async function tick() {
    if (!running) return;
    lastTickAt = nowMs();
    try {
      await processBatch();
      lastTickError = '';
      lastTickErrorAt = 0;
    } catch (error) {
      lastTickError = String(error?.message || error);
      lastTickErrorAt = nowMs();
      logSecurityError('payment_webhook_ingest_tick_failed', {
        workerId: id,
        message: lastTickError,
      });
    } finally {
      if (running) {
        pollTimer = setTimeout(tick, pollIntervalMs);
      }
    }
  }

  function start() {
    if (running) return;
    running = true;
    logSecurityEvent('payment_webhook_ingest_worker_started', {
      workerId: id,
      pollIntervalMs,
      batchSize,
      workerConcurrency,
    });
    tick();
    cleanupTimer = setInterval(() => {
      cleanupProcessed().catch((error) => {
        logSecurityWarning('payment_webhook_ingest_cleanup_failed', {
          workerId: id,
          message: String(error?.message || error),
        });
      });
    }, cleanupEveryMs);
  }

  async function stop() {
    running = false;
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    await PaymentWebhookIngestEvent.updateMany(
      { status: 'processing', lockedBy: id },
      {
        $set: {
          status: 'failed',
          lockExpiresAt: null,
          lockedBy: '',
          heartbeatAt: null,
          processingStartedAt: null,
          nextAttemptAt: new Date(nowMs() + backoffMs(1)),
          lastError: 'worker_stopped_mid_processing',
          lastErrorAt: new Date(),
        },
      },
    );
    logSecurityEvent('payment_webhook_ingest_worker_stopped', {
      workerId: id,
      metrics,
    });
  }

  return {
    id,
    metrics,
    start,
    stop,
    processBatch,
    getStatus() {
      return {
        workerId: id,
        running,
        lastTickAt,
        lastTickError,
        lastTickErrorAt,
        metrics: { ...metrics },
      };
    },
  };
}

let singletonWorker = null;

function startPaymentWebhookIngestWorker(options = {}) {
  if (singletonWorker) return singletonWorker;
  singletonWorker = createPaymentWebhookIngestWorker(options);
  singletonWorker.start();
  return singletonWorker;
}

async function stopPaymentWebhookIngestWorker() {
  if (!singletonWorker) return;
  await singletonWorker.stop();
  singletonWorker = null;
}

function getPaymentWebhookIngestWorkerStatus() {
  if (!singletonWorker) {
    return {
      workerId: '',
      running: false,
      lastTickAt: 0,
      lastTickError: '',
      lastTickErrorAt: 0,
      metrics: createIngestMetrics(),
    };
  }
  return singletonWorker.getStatus();
}

module.exports = {
  createPaymentWebhookIngestWorker,
  getPaymentWebhookIngestWorkerStatus,
  persistWebhookIngestEvent,
  startPaymentWebhookIngestWorker,
  stopPaymentWebhookIngestWorker,
};
