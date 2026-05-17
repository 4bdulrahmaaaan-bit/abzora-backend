const os = require('os');
const crypto = require('crypto');

const PaymentOutboxEvent = require('../models/PaymentOutboxEvent');
const Transaction = require('../models/Transaction');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const AdminNotification = require('../models/AdminNotification');
const FinanceAuditLog = require('../models/FinanceAuditLog');
const { logSecurityEvent, logSecurityWarning, logSecurityError } = require('./auditLogger');
const telemetry = require('./telemetryContext');
const telemetryMetrics = require('./telemetryMetrics');
const otel = require('./otelService');

function nowMs() {
  return Date.now();
}

function nowIso() {
  return new Date().toISOString();
}

function jitterMs(max) {
  return Math.floor(Math.random() * Math.max(1, Number(max || 0)));
}

function buildBackoffMs(attempt) {
  const base = 1000;
  const cap = 5 * 60 * 1000;
  const exp = Math.min(cap, base * (2 ** Math.max(0, attempt - 1)));
  return exp + jitterMs(Math.floor(exp * 0.2));
}

function createMetrics() {
  return {
    claimed: 0,
    processed: 0,
    retriesScheduled: 0,
    deadLettered: 0,
    duplicatesSkipped: 0,
    targetReplaySuccess: 0,
    targetReplayFailures: 0,
    lockLost: 0,
    noWorkPolls: 0,
    heartbeatRenewals: 0,
  };
}

function workerId() {
  return `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeMap(mapLike = {}) {
  if (mapLike instanceof Map) {
    return Object.fromEntries(mapLike.entries());
  }
  if (typeof mapLike === 'object' && mapLike) {
    return { ...mapLike };
  }
  return {};
}

async function replayAudit(event) {
  const metadata = normalizeMap(event.payload);
  const outboxEventId = String(event.eventId || '');
  const existing = await FinanceAuditLog.findOne({
    action: 'outbox_replay_audit',
    'metadata.outboxEventId': outboxEventId,
  });
  if (existing) {
    return { skippedDuplicate: true };
  }
  await FinanceAuditLog.create({
    action: 'outbox_replay_audit',
    actorId: 'payment-outbox-worker',
    actorRole: 'system',
    status: 'success',
    walletType: 'admin',
    storeId: '',
    riderId: '',
    orderIds: [String(event.orderId || '')],
    amount: 0,
    message: `Replayed audit side effect for ${event.eventType}`,
    createdAtIso: nowIso(),
    metadata: {
      outboxEventId,
      eventType: String(event.eventType || ''),
      ...Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])),
    },
  });
  return { skippedDuplicate: false };
}

async function replayAnalytics(event) {
  const metadata = normalizeMap(event.payload);
  const outboxEventId = String(event.eventId || '');
  const existing = await AnalyticsEvent.findOne({
    eventType: 'outbox_replay',
    'metadata.outboxEventId': outboxEventId,
  });
  if (existing) {
    return { skippedDuplicate: true };
  }
  await AnalyticsEvent.create({
    eventType: 'outbox_replay',
    userId: metadata.userId || '',
    sessionId: metadata.sessionId || '',
    productId: metadata.productId || '',
    decisionId: metadata.decisionId || '',
    cta: '',
    metadata: {
      outboxEventId,
      eventType: String(event.eventType || ''),
      orderId: String(event.orderId || ''),
    },
    timestamp: new Date(),
  });
  return { skippedDuplicate: false };
}

async function replaySettlement(event) {
  const metadata = normalizeMap(event.payload);
  const outboxEventId = String(event.eventId || '');
  const transactionId = `outbox-settlement-${outboxEventId}`;
  const existing = await Transaction.findOne({ transactionId });
  if (existing) {
    return { skippedDuplicate: true };
  }
  await Transaction.create({
    transactionId,
    type: 'escrow',
    userType: 'admin',
    userId: 'primary',
    storeId: metadata.storeId || '',
    riderId: metadata.riderId || '',
    orderId: String(event.orderId || ''),
    payoutId: '',
    amount: 0,
    status: 'processed',
    note: `Outbox settlement replay for ${event.eventType}`,
    createdAtIso: nowIso(),
    metadata: {
      outboxEventId,
      eventType: String(event.eventType || ''),
    },
  });
  return { skippedDuplicate: false };
}

async function replayNotification(event) {
  const metadata = normalizeMap(event.payload);
  const notificationId = `outbox-notify-${String(event.eventId || '')}`;
  const existing = await AdminNotification.findOne({ notificationId });
  if (existing) {
    return { skippedDuplicate: true };
  }
  await AdminNotification.create({
    notificationId,
    title: 'Outbox Replay Completed',
    body: `Replay event ${event.eventType} processed for order ${event.orderId}.`,
    type: 'outbox_replay',
    isRead: false,
    timestamp: nowIso(),
    audienceRole: 'admin',
    userId: metadata.userId || '',
    storeId: metadata.storeId || '',
  });
  return { skippedDuplicate: false };
}

const TARGET_REPLAYERS = {
  audit: replayAudit,
  analytics: replayAnalytics,
  settlement: replaySettlement,
  notification: replayNotification,
};

function createPaymentOutboxWorker(options = {}) {
  const id = options.workerId || workerId();
  const pollIntervalMs = Math.max(250, Number(options.pollIntervalMs || 1000));
  const batchSize = Math.max(1, Number(options.batchSize || 5));
  const leaseMs = Math.max(3000, Number(options.leaseMs || 15000));
  const maxAttemptsDefault = Math.max(1, Number(options.maxAttemptsDefault || 8));
  const heartbeatEveryMs = Math.max(1000, Math.floor(leaseMs / 3));
  const cleanupEveryMs = Math.max(60000, Number(options.cleanupEveryMs || 10 * 60 * 1000));
  const completedRetentionMs = Math.max(60000, Number(options.completedRetentionMs || 3 * 24 * 60 * 60 * 1000));

  const metrics = createMetrics();
  let running = false;
  let pollTimer = null;
  let cleanupTimer = null;
  let lastTickAt = 0;
  let lastTickError = '';
  let lastTickErrorAt = 0;

  async function claimOne() {
    const now = new Date();
    const claimed = await PaymentOutboxEvent.findOneAndUpdate(
      {
        status: { $in: ['pending', 'failed'] },
        deadLetter: { $ne: true },
        attempts: { $lt: maxAttemptsDefault },
        $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
        $or: [{ lockExpiresAt: { $exists: false } }, { lockExpiresAt: null }, { lockExpiresAt: { $lte: now } }],
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
    }
    return claimed;
  }

  async function heartbeat(eventDoc) {
    const now = new Date();
    const updated = await PaymentOutboxEvent.updateOne(
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
    await PaymentOutboxEvent.updateOne(
      { _id: eventDoc._id, status: 'processing', lockedBy: id },
      {
        $set: {
          status: 'processed',
          processedAtIso: nowIso(),
          deadLetter: false,
          deadLetterReason: '',
          lastError: '',
          lastErrorAt: null,
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
    const nextMs = buildBackoffMs(Number(eventDoc.attempts || 1));
    const nextDate = new Date(nowMs() + nextMs);
    const maxAttempts = Number(eventDoc.maxAttempts || maxAttemptsDefault);
    const attempts = Number(eventDoc.attempts || 0);
    const exhausted = attempts >= maxAttempts;

    if (exhausted) {
      await PaymentOutboxEvent.updateOne(
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
            nextAttemptAt: nextDate,
          },
        },
      );
      metrics.deadLettered += 1;
      return;
    }

    await PaymentOutboxEvent.updateOne(
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
          nextAttemptAt: nextDate,
        },
      },
    );
    metrics.retriesScheduled += 1;
  }

  async function replayTargets(eventDoc) {
    const completedTargets = new Set(Array.isArray(eventDoc.completedTargets) ? eventDoc.completedTargets : []);
    const targetErrors = normalizeMap(eventDoc.targetErrors);

    for (const [target, replayFn] of Object.entries(TARGET_REPLAYERS)) {
      if (completedTargets.has(target)) {
        metrics.duplicatesSkipped += 1;
        continue;
      }
      const result = await replayFn(eventDoc);
      if (result?.skippedDuplicate) {
        // Idempotency hardening: duplicate downstream side effects are treated as success.
        completedTargets.add(target);
        metrics.duplicatesSkipped += 1;
      } else {
        completedTargets.add(target);
        metrics.targetReplaySuccess += 1;
      }
      delete targetErrors[target];
      await PaymentOutboxEvent.updateOne(
        { _id: eventDoc._id, status: 'processing', lockedBy: id },
        { $set: { completedTargets: [...completedTargets], targetErrors } },
      );
    }
  }

  async function processEvent(eventDoc) {
    let heartbeatTimer = null;
    const traceContext = telemetry.extractContext({
      traceContext: {
        traceId: eventDoc?.metadata?.get?.('traceId') || eventDoc?.metadata?.traceId || '',
        spanId: eventDoc?.metadata?.get?.('spanId') || eventDoc?.metadata?.spanId || '',
        requestId: eventDoc?.metadata?.get?.('requestId') || eventDoc?.metadata?.requestId || '',
      },
    });
    return telemetry.runWithContext(
      telemetry.createChildContext(traceContext || {}, {
        operation: 'payment_outbox_replay',
        workerId: id,
        module: 'paymentOutboxWorker',
        jobId: String(eventDoc?.eventId || ''),
      }),
      async () => {
        const started = nowMs();
        const span = otel.startSpan('outbox.replay.process', {
          'abzora.flow': 'outbox_replay',
          'abzora.event_type': String(eventDoc?.eventType || 'unknown'),
        });
        try {
      heartbeatTimer = setInterval(() => {
        heartbeat(eventDoc).catch((error) => {
          logSecurityWarning('payment_outbox_heartbeat_failed', {
            workerId: id,
            eventId: eventDoc.eventId,
            message: String(error?.message || error),
          });
        });
      }, heartbeatEveryMs);

      await replayTargets(eventDoc);
      if (!(await heartbeat(eventDoc))) {
        throw new Error('Outbox lock lost while processing event.');
      }
      await markProcessed(eventDoc);
          telemetryMetrics.observe('outbox_replay_latency_ms', nowMs() - started, {
            eventType: String(eventDoc?.eventType || 'unknown'),
          });
      logSecurityEvent('payment_outbox_processed', {
        workerId: id,
        eventId: eventDoc.eventId,
        eventType: eventDoc.eventType,
        orderId: eventDoc.orderId,
      });
        } catch (error) {
      metrics.targetReplayFailures += 1;
      await markRetry(eventDoc, error);
      logSecurityWarning('payment_outbox_retry_scheduled', {
        workerId: id,
        eventId: eventDoc.eventId,
        eventType: eventDoc.eventType,
        attempts: Number(eventDoc.attempts || 0),
        message: String(error?.message || error),
      });
          telemetryMetrics.inc('outbox_replay_retry_total', 1, {
            eventType: String(eventDoc?.eventType || 'unknown'),
          });
    } finally {
      span.setAttribute('abzora.latency_ms', nowMs() - started);
      span.end();
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
    }
      },
    );
  }

  async function processOnce() {
    let processedCount = 0;
    for (let i = 0; i < batchSize; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const claimed = await claimOne();
      if (!claimed) {
        metrics.noWorkPolls += 1;
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await processEvent(claimed);
      processedCount += 1;
    }
    return processedCount;
  }

  async function cleanupCompleted() {
    const cutoff = new Date(nowMs() - completedRetentionMs);
    const result = await PaymentOutboxEvent.deleteMany({
      status: 'processed',
      processedAtIso: { $ne: '' },
      updatedAt: { $lt: cutoff },
    });
    if (result.deletedCount > 0) {
      logSecurityEvent('payment_outbox_cleanup', {
        workerId: id,
        deletedCount: result.deletedCount,
      });
    }
  }

  async function tick() {
    if (!running) {
      return;
    }
    lastTickAt = nowMs();
    try {
      await processOnce();
      lastTickError = '';
      lastTickErrorAt = 0;
    } catch (error) {
      lastTickError = String(error?.message || error);
      lastTickErrorAt = nowMs();
      logSecurityError('payment_outbox_tick_failed', {
        workerId: id,
        message: String(error?.message || error),
      });
    } finally {
      if (running) {
        pollTimer = setTimeout(tick, pollIntervalMs);
      }
    }
  }

  function start() {
    if (running) {
      return;
    }
    running = true;
    logSecurityEvent('payment_outbox_worker_started', {
      workerId: id,
      pollIntervalMs,
      batchSize,
      leaseMs,
    });
    tick();
    cleanupTimer = setInterval(() => {
      cleanupCompleted().catch((error) => {
        logSecurityWarning('payment_outbox_cleanup_failed', {
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
    await PaymentOutboxEvent.updateMany(
      { status: 'processing', lockedBy: id },
      {
        $set: {
          status: 'failed',
          lockExpiresAt: null,
          lockedBy: '',
          heartbeatAt: null,
          processingStartedAt: null,
          nextAttemptAt: new Date(nowMs() + buildBackoffMs(1)),
          lastError: 'worker_stopped_mid_processing',
          lastErrorAt: new Date(),
        },
      },
    );
    logSecurityEvent('payment_outbox_worker_stopped', {
      workerId: id,
      metrics,
    });
  }

  return {
    id,
    start,
    stop,
    processOnce,
    cleanupCompleted,
    metrics,
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

function startPaymentOutboxWorker(options = {}) {
  if (singletonWorker) {
    return singletonWorker;
  }
  singletonWorker = createPaymentOutboxWorker(options);
  singletonWorker.start();
  return singletonWorker;
}

function getPaymentOutboxWorkerStatus() {
  if (!singletonWorker) {
    return {
      workerId: '',
      running: false,
      lastTickAt: 0,
      lastTickError: '',
      lastTickErrorAt: 0,
      metrics: createMetrics(),
    };
  }
  return singletonWorker.getStatus();
}

async function stopPaymentOutboxWorker() {
  if (!singletonWorker) {
    return;
  }
  await singletonWorker.stop();
  singletonWorker = null;
}

module.exports = {
  createPaymentOutboxWorker,
  getPaymentOutboxWorkerStatus,
  startPaymentOutboxWorker,
  stopPaymentOutboxWorker,
};
