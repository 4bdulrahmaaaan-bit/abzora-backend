const { computeOutboxMetrics } = require('../services/outboxMetricsService');
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
    logSecurityEvent('outbox_metrics_access', payload);
    return;
  }
  logSecurityWarning('outbox_metrics_access_denied', payload);
}

async function getOutboxWorkerHealth(req, res, next) {
  try {
    const allowed = isAdmin(req.user);
    auditAccess(req, allowed);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const metrics = await computeOutboxMetrics();
    return res.status(200).json({
      success: true,
      data: {
        generatedAtIso: metrics.generatedAtIso,
        worker: metrics.worker,
        anomalies: metrics.anomalies,
        alerts: metrics.alerts,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getOutboxMetrics(req, res, next) {
  try {
    const allowed = isAdmin(req.user);
    auditAccess(req, allowed);
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    const metrics = await computeOutboxMetrics();
    const format = String(req.query?.format || '').trim().toLowerCase();
    if (format === 'prometheus') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      return res.status(200).send(metrics.prometheus);
    }
    return res.status(200).json({
      success: true,
      data: {
        generatedAtIso: metrics.generatedAtIso,
        counts: metrics.counts,
        retries: metrics.retries,
        throughput: metrics.throughput,
        oldestPendingAgeSeconds: metrics.oldestPendingAgeSeconds,
        anomalies: metrics.anomalies,
        deadLetters: metrics.deadLetters,
        worker: metrics.worker,
        alerts: metrics.alerts,
        thresholds: metrics.thresholds,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getOutboxMetrics,
  getOutboxWorkerHealth,
};
