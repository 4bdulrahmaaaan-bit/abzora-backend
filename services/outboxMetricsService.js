const PaymentOutboxEvent = require('../models/PaymentOutboxEvent');
const { getPaymentOutboxWorkerStatus } = require('./paymentOutboxWorker');

function numberEnv(name, fallback) {
  const parsed = Number(process.env[name] || fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function alertThresholds() {
  return {
    deadLetterCountWarn: numberEnv('OUTBOX_ALERT_DEADLETTER_WARN', 25),
    deadLetter5mWarn: numberEnv('OUTBOX_ALERT_DEADLETTER_5M_WARN', 10),
    stuckProcessingWarn: numberEnv('OUTBOX_ALERT_STUCK_PROCESSING_WARN', 5),
    retryStormWarn: numberEnv('OUTBOX_ALERT_RETRY_STORM_WARN', 50),
    backlogWarn: numberEnv('OUTBOX_ALERT_BACKLOG_WARN', 500),
    heartbeatStaleMsWarn: numberEnv('OUTBOX_ALERT_HEARTBEAT_STALE_MS_WARN', 60_000),
  };
}

function ageSecondsFromDate(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 1000));
}

function buildPrometheus(payload) {
  const lines = [];
  const metric = (name, value) => lines.push(`${name} ${Number(value || 0)}`);
  metric('outbox_pending_count', payload.counts.pending);
  metric('outbox_failed_count', payload.counts.failed);
  metric('outbox_deadletter_count', payload.counts.deadLetter);
  metric('outbox_processing_count', payload.counts.processing);
  metric('outbox_retry_high_count', payload.retries.highRetryCount);
  metric('outbox_retry_total_attempts', payload.retries.totalAttempts);
  metric('outbox_oldest_pending_age_seconds', payload.oldestPendingAgeSeconds);
  metric('outbox_processing_stale_lease_count', payload.anomalies.staleLeaseCount);
  metric('outbox_processing_stale_heartbeat_count', payload.anomalies.staleHeartbeatCount);
  metric('outbox_throughput_processed_1m', payload.throughput.processedLast1m);
  metric('outbox_throughput_processed_5m', payload.throughput.processedLast5m);
  metric('outbox_throughput_processed_1h', payload.throughput.processedLast1h);
  metric('outbox_worker_running', payload.worker.running ? 1 : 0);
  metric('outbox_worker_heartbeat_stale', payload.worker.heartbeatStale ? 1 : 0);
  metric('outbox_alerts_active', payload.alerts.length);
  return `${lines.join('\n')}\n`;
}

function computeAlerts(metrics, thresholds) {
  const alerts = [];
  if (metrics.counts.deadLetter >= thresholds.deadLetterCountWarn) {
    alerts.push({
      code: 'dead_letter_count_high',
      severity: 'warn',
      value: metrics.counts.deadLetter,
      threshold: thresholds.deadLetterCountWarn,
    });
  }
  if (metrics.deadLetters.last5m >= thresholds.deadLetter5mWarn) {
    alerts.push({
      code: 'dead_letter_spike_5m',
      severity: 'warn',
      value: metrics.deadLetters.last5m,
      threshold: thresholds.deadLetter5mWarn,
    });
  }
  if (metrics.anomalies.stuckProcessingCount >= thresholds.stuckProcessingWarn) {
    alerts.push({
      code: 'stuck_processing_events',
      severity: 'warn',
      value: metrics.anomalies.stuckProcessingCount,
      threshold: thresholds.stuckProcessingWarn,
    });
  }
  if (metrics.retries.highRetryCount >= thresholds.retryStormWarn) {
    alerts.push({
      code: 'retry_storm',
      severity: 'warn',
      value: metrics.retries.highRetryCount,
      threshold: thresholds.retryStormWarn,
    });
  }
  if (metrics.worker.heartbeatStale) {
    alerts.push({
      code: 'worker_heartbeat_stale',
      severity: 'warn',
      value: metrics.worker.heartbeatAgeMs,
      threshold: thresholds.heartbeatStaleMsWarn,
    });
  }
  if (metrics.counts.pending >= thresholds.backlogWarn) {
    alerts.push({
      code: 'backlog_growth',
      severity: 'warn',
      value: metrics.counts.pending,
      threshold: thresholds.backlogWarn,
    });
  }
  return alerts;
}

async function computeOutboxMetrics() {
  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const staleHeartbeatCutoff = new Date(
    now.getTime() - numberEnv('OUTBOX_STALE_HEARTBEAT_MS', 30_000),
  );

  const [
    pending,
    failed,
    deadLetter,
    processing,
    retryStats,
    oldestPending,
    staleLeaseCount,
    staleHeartbeatCount,
    deadLetterLast5m,
    processedLast1m,
    processedLast5m,
    processedLast1h,
    stuckProcessingCount,
  ] = await Promise.all([
    PaymentOutboxEvent.countDocuments({ status: 'pending', deadLetter: { $ne: true } }),
    PaymentOutboxEvent.countDocuments({ status: 'failed', deadLetter: { $ne: true } }),
    PaymentOutboxEvent.countDocuments({ deadLetter: true }),
    PaymentOutboxEvent.countDocuments({ status: 'processing' }),
    PaymentOutboxEvent.aggregate([
      {
        $group: {
          _id: null,
          totalAttempts: { $sum: { $ifNull: ['$attempts', 0] } },
          highRetryCount: {
            $sum: {
              $cond: [{ $gte: [{ $ifNull: ['$attempts', 0] }, 3] }, 1, 0],
            },
          },
          maxAttemptsSeen: { $max: { $ifNull: ['$attempts', 0] } },
        },
      },
    ]),
    PaymentOutboxEvent.findOne({
      status: 'pending',
      deadLetter: { $ne: true },
    }).sort({ createdAt: 1 }).select({ createdAt: 1 }).lean(),
    PaymentOutboxEvent.countDocuments({
      status: 'processing',
      lockExpiresAt: { $ne: null, $lt: now },
    }),
    PaymentOutboxEvent.countDocuments({
      status: 'processing',
      $or: [{ heartbeatAt: null }, { heartbeatAt: { $lt: staleHeartbeatCutoff } }],
    }),
    PaymentOutboxEvent.countDocuments({
      deadLetter: true,
      updatedAt: { $gte: fiveMinutesAgo },
    }),
    PaymentOutboxEvent.countDocuments({
      status: 'processed',
      updatedAt: { $gte: oneMinuteAgo },
    }),
    PaymentOutboxEvent.countDocuments({
      status: 'processed',
      updatedAt: { $gte: fiveMinutesAgo },
    }),
    PaymentOutboxEvent.countDocuments({
      status: 'processed',
      updatedAt: { $gte: oneHourAgo },
    }),
    PaymentOutboxEvent.countDocuments({
      status: 'processing',
      processingStartedAt: { $ne: null, $lt: fiveMinutesAgo },
    }),
  ]);

  const retryAgg = retryStats[0] || {
    totalAttempts: 0,
    highRetryCount: 0,
    maxAttemptsSeen: 0,
  };
  const worker = getPaymentOutboxWorkerStatus();
  const thresholds = alertThresholds();
  const heartbeatAgeMs = worker.lastTickAt ? Math.max(0, Date.now() - worker.lastTickAt) : Number.MAX_SAFE_INTEGER;
  const heartbeatStale = !worker.running || heartbeatAgeMs > thresholds.heartbeatStaleMsWarn;

  const metrics = {
    generatedAtIso: new Date().toISOString(),
    counts: {
      pending,
      failed,
      deadLetter,
      processing,
    },
    retries: {
      totalAttempts: Number(retryAgg.totalAttempts || 0),
      highRetryCount: Number(retryAgg.highRetryCount || 0),
      maxAttemptsSeen: Number(retryAgg.maxAttemptsSeen || 0),
    },
    oldestPendingAgeSeconds: ageSecondsFromDate(oldestPending?.createdAt),
    anomalies: {
      staleLeaseCount,
      staleHeartbeatCount,
      stuckProcessingCount,
    },
    throughput: {
      processedLast1m,
      processedLast5m,
      processedLast1h,
    },
    deadLetters: {
      last5m: deadLetterLast5m,
    },
    worker: {
      workerId: worker.workerId,
      running: Boolean(worker.running),
      lastTickAt: worker.lastTickAt || 0,
      lastTickError: worker.lastTickError || '',
      lastTickErrorAt: worker.lastTickErrorAt || 0,
      heartbeatAgeMs,
      heartbeatStale,
      metrics: worker.metrics || {},
    },
    thresholds,
  };
  metrics.alerts = computeAlerts(metrics, thresholds);
  metrics.prometheus = buildPrometheus(metrics);
  return metrics;
}

module.exports = {
  computeOutboxMetrics,
};
