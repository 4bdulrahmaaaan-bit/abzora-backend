const PaymentWebhookIngestEvent = require('../models/PaymentWebhookIngestEvent');
const { getPaymentWebhookIngestWorkerStatus } = require('../services/paymentWebhookIngestService');
const { logSecurityEvent, logSecurityWarning } = require('../services/auditLogger');

function isAdmin(user) {
  const role = String(user?.role || '').trim().toLowerCase();
  return role === 'admin' || role === 'super_admin';
}

function auditAccess(req, allowed) {
  const payload = {
    requestId: req.requestId || '',
    path: req.originalUrl || '',
    userId: String(req.user?.uid || ''),
    role: String(req.user?.role || ''),
    allowed,
  };
  if (allowed) {
    logSecurityEvent('webhook_ingest_metrics_access', payload);
    return;
  }
  logSecurityWarning('webhook_ingest_metrics_access_denied', payload);
}

function prom(payload) {
  const lines = [];
  const metric = (name, value) => lines.push(`${name} ${Number(value || 0)}`);
  metric('webhook_ingest_pending_count', payload.counts.pending);
  metric('webhook_ingest_failed_count', payload.counts.failed);
  metric('webhook_ingest_deadletter_count', payload.counts.deadLetter);
  metric('webhook_ingest_processing_count', payload.counts.processing);
  metric('webhook_ingest_oldest_pending_age_seconds', payload.oldestPendingAgeSeconds);
  metric('webhook_ingest_worker_running', payload.worker.running ? 1 : 0);
  metric('webhook_ingest_worker_heartbeat_stale', payload.worker.heartbeatStale ? 1 : 0);
  metric('webhook_ingest_queue_lag_ms_avg', payload.worker.avgQueueLagMs);
  metric('webhook_ingest_processed_total', payload.worker.metrics.processed);
  metric('webhook_ingest_retries_total', payload.worker.metrics.retriesScheduled);
  metric('webhook_ingest_deadletter_total', payload.worker.metrics.deadLettered);
  return `${lines.join('\n')}\n`;
}

async function computeWebhookIngestMetrics() {
  const now = new Date();
  const staleMs = Number(process.env.WEBHOOK_INGEST_HEARTBEAT_STALE_MS || 60000);
  const [pending, failed, deadLetter, processing, oldestPending] = await Promise.all([
    PaymentWebhookIngestEvent.countDocuments({ status: 'pending', deadLetter: { $ne: true } }),
    PaymentWebhookIngestEvent.countDocuments({ status: 'failed', deadLetter: { $ne: true } }),
    PaymentWebhookIngestEvent.countDocuments({ deadLetter: true }),
    PaymentWebhookIngestEvent.countDocuments({ status: 'processing' }),
    PaymentWebhookIngestEvent.findOne({ status: 'pending', deadLetter: { $ne: true } }).sort({ createdAt: 1 }).select({ createdAt: 1 }).lean(),
  ]);
  const worker = getPaymentWebhookIngestWorkerStatus();
  const heartbeatAgeMs = worker.lastTickAt ? Math.max(0, Date.now() - worker.lastTickAt) : Number.MAX_SAFE_INTEGER;
  const heartbeatStale = !worker.running || heartbeatAgeMs > staleMs;
  const oldestPendingAgeSeconds = oldestPending?.createdAt
    ? Math.max(0, Math.floor((now.getTime() - new Date(oldestPending.createdAt).getTime()) / 1000))
    : 0;
  const avgQueueLagMs = Number(worker.metrics?.queueLagSamples || 0) > 0
    ? Math.round(Number(worker.metrics.queueLagMsTotal || 0) / Number(worker.metrics.queueLagSamples || 1))
    : 0;

  const payload = {
    generatedAtIso: now.toISOString(),
    counts: { pending, failed, deadLetter, processing },
    oldestPendingAgeSeconds,
    worker: {
      ...worker,
      heartbeatAgeMs,
      heartbeatStale,
      avgQueueLagMs,
    },
  };
  payload.prometheus = prom(payload);
  return payload;
}

async function getWebhookIngestHealth(req, res, next) {
  try {
    const allowed = isAdmin(req.user);
    auditAccess(req, allowed);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const metrics = await computeWebhookIngestMetrics();
    return res.status(200).json({
      success: true,
      data: {
        generatedAtIso: metrics.generatedAtIso,
        counts: metrics.counts,
        worker: metrics.worker,
        oldestPendingAgeSeconds: metrics.oldestPendingAgeSeconds,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getWebhookIngestMetrics(req, res, next) {
  try {
    const allowed = isAdmin(req.user);
    auditAccess(req, allowed);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const metrics = await computeWebhookIngestMetrics();
    if (String(req.query?.format || '').trim().toLowerCase() === 'prometheus') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      return res.status(200).send(metrics.prometheus);
    }
    return res.status(200).json({ success: true, data: metrics });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getWebhookIngestHealth,
  getWebhookIngestMetrics,
};
