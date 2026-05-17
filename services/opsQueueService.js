const { ALERT_SEVERITY } = require('./opsConstants');
const {
  allowMemoryFallback,
  getRedisConfigSummary,
  getRedisUrl,
  isRedisDisabled,
  isRedisRequired,
} = require('./redisRuntimeConfig');
const { ensureRedisClient } = require('./redisClientManager');

const QUEUE_KEYS = {
  [ALERT_SEVERITY.CRITICAL]: 'ops:queue:critical',
  [ALERT_SEVERITY.HIGH]: 'ops:queue:high',
  [ALERT_SEVERITY.MEDIUM]: 'ops:queue:medium',
  [ALERT_SEVERITY.LOW]: 'ops:queue:low',
};
const RETRY_QUEUE_KEYS = {
  [ALERT_SEVERITY.CRITICAL]: 'ops:queue:retry:critical',
  [ALERT_SEVERITY.HIGH]: 'ops:queue:retry:high',
  [ALERT_SEVERITY.MEDIUM]: 'ops:queue:retry:medium',
  [ALERT_SEVERITY.LOW]: 'ops:queue:retry:low',
};

const localQueue = {
  [ALERT_SEVERITY.CRITICAL]: [],
  [ALERT_SEVERITY.HIGH]: [],
  [ALERT_SEVERITY.MEDIUM]: [],
  [ALERT_SEVERITY.LOW]: [],
};
const localRetryQueue = {
  [ALERT_SEVERITY.CRITICAL]: [],
  [ALERT_SEVERITY.HIGH]: [],
  [ALERT_SEVERITY.MEDIUM]: [],
  [ALERT_SEVERITY.LOW]: [],
};
const localTenantWindow = new Map();

const queueMetrics = {
  enqueued: 0,
  dequeued: 0,
  deferred: 0,
  dropped: 0,
  rejected: 0,
  retryScheduled: 0,
  retryPromoted: 0,
  dequeueLagMsTotal: 0,
  dequeueLagSamples: 0,
  overloadEvents: 0,
};

let client = null;
let redisAvailable = false;

function numberEnv(name, fallback, min = 0) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, value);
}

function queueLimits() {
  return {
    globalMax: numberEnv('OPS_QUEUE_GLOBAL_MAX', 5000, 100),
    criticalMax: numberEnv('OPS_QUEUE_CRITICAL_MAX', 1500, 10),
    highMax: numberEnv('OPS_QUEUE_HIGH_MAX', 1500, 10),
    mediumMax: numberEnv('OPS_QUEUE_MEDIUM_MAX', 1200, 10),
    lowMax: numberEnv('OPS_QUEUE_LOW_MAX', 800, 10),
    retryPromotePerTick: numberEnv('OPS_QUEUE_RETRY_PROMOTE_PER_TICK', 30, 1),
    retryConcurrencyCap: numberEnv('OPS_QUEUE_RETRY_CONCURRENCY_CAP', 2, 1),
    perTenantWindowMax: numberEnv('OPS_QUEUE_PER_TENANT_WINDOW_MAX', 200, 1),
    perTenantWindowMs: numberEnv('OPS_QUEUE_PER_TENANT_WINDOW_MS', 60000, 1000),
  };
}

function overloadPolicy() {
  const policy = String(process.env.OPS_QUEUE_OVERLOAD_POLICY || 'defer').trim().toLowerCase();
  if (policy === 'reject' || policy === 'drop') {
    return policy;
  }
  return 'defer';
}

function shouldShedNonCritical() {
  return String(process.env.OPS_QUEUE_SHED_NON_CRITICAL || '').trim().toLowerCase() === 'true';
}

function severityLimit(severity, limits) {
  if (severity === ALERT_SEVERITY.CRITICAL) return limits.criticalMax;
  if (severity === ALERT_SEVERITY.HIGH) return limits.highMax;
  if (severity === ALERT_SEVERITY.MEDIUM) return limits.mediumMax;
  return limits.lowMax;
}

function normalizeEnvelope({
  alertId,
  severity,
  tenantKey = '',
  isRetry = false,
  retryCount = 0,
  jobClass = 'operational',
  enqueuedAt = Date.now(),
}) {
  return {
    alertId: String(alertId || '').trim(),
    severity: QUEUE_KEYS[severity] ? severity : ALERT_SEVERITY.LOW,
    tenantKey: String(tenantKey || '').trim(),
    isRetry: Boolean(isRetry),
    retryCount: Number(retryCount || 0),
    jobClass: String(jobClass || 'operational').trim().toLowerCase(),
    enqueuedAt: Number(enqueuedAt || Date.now()),
  };
}

function parseEnvelope(raw, fallbackSeverity) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return normalizeEnvelope({
      ...parsed,
      severity: parsed.severity || fallbackSeverity,
    });
  } catch (_) {
    return normalizeEnvelope({
      alertId: String(raw),
      severity: fallbackSeverity,
    });
  }
}

function jitterMs(maxJitterMs = 500) {
  return Math.floor(Math.random() * Math.max(1, maxJitterMs));
}

async function ensureRedis() {
  if (client || isRedisDisabled()) {
    return client;
  }
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  try {
    client = await ensureRedisClient();
    if (!client) {
      redisAvailable = false;
      return null;
    }
    client.on('error', () => {
      redisAvailable = false;
    });
    client.on('ready', () => {
      redisAvailable = true;
    });
    redisAvailable = true;
    return client;
  } catch (_) {
    client = null;
    redisAvailable = false;
    return null;
  }
}

async function currentDepthBySeverity(redis) {
  const ordered = [ALERT_SEVERITY.CRITICAL, ALERT_SEVERITY.HIGH, ALERT_SEVERITY.MEDIUM, ALERT_SEVERITY.LOW];
  const bySeverity = {};
  let total = 0;
  if (redis && redisAvailable) {
    for (const sev of ordered) {
      // eslint-disable-next-line no-await-in-loop
      const depth = Number(await redis.lLen(QUEUE_KEYS[sev])) || 0;
      bySeverity[sev] = depth;
      total += depth;
    }
    return { total, bySeverity };
  }
  for (const sev of ordered) {
    const depth = localQueue[sev].length;
    bySeverity[sev] = depth;
    total += depth;
  }
  return { total, bySeverity };
}

function localTenantAllowed(tenantKey, limits) {
  if (!tenantKey) return true;
  const now = Date.now();
  const state = localTenantWindow.get(tenantKey) || { count: 0, resetAt: now + limits.perTenantWindowMs };
  if (state.resetAt <= now) {
    state.count = 0;
    state.resetAt = now + limits.perTenantWindowMs;
  }
  if (state.count >= limits.perTenantWindowMax) {
    localTenantWindow.set(tenantKey, state);
    return false;
  }
  state.count += 1;
  localTenantWindow.set(tenantKey, state);
  return true;
}

async function tenantAllowed(redis, tenantKey, limits) {
  if (!tenantKey) return true;
  if (redis && redisAvailable) {
    const key = `ops:tenant:enqueue:${tenantKey}`;
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.pExpire(key, limits.perTenantWindowMs);
    }
    return count <= limits.perTenantWindowMax;
  }
  if (isRedisRequired()) return false;
  return localTenantAllowed(tenantKey, limits);
}

function isCriticalClass(envelope) {
  return envelope.severity === ALERT_SEVERITY.CRITICAL
    || envelope.severity === ALERT_SEVERITY.HIGH
    || envelope.jobClass === 'payment'
    || envelope.jobClass === 'order';
}

function decideAdmission(envelope, depth, limits) {
  const perPriorityDepth = Number(depth.bySeverity[envelope.severity] || 0);
  const perPriorityMax = severityLimit(envelope.severity, limits);
  const globalSaturated = depth.total >= limits.globalMax;
  const prioritySaturated = perPriorityDepth >= perPriorityMax;
  const saturated = globalSaturated || prioritySaturated;

  if (!saturated) return { status: 'accepted', reason: '' };
  queueMetrics.overloadEvents += 1;
  const policy = overloadPolicy();

  // Security hardening: always preserve critical payment/order paths under overload.
  if (isCriticalClass(envelope)) return { status: 'accepted', reason: 'critical_bypass' };

  if (shouldShedNonCritical() && (envelope.jobClass === 'analytics' || envelope.jobClass === 'audit')) {
    return { status: 'dropped', reason: 'shed_non_critical' };
  }
  if (policy === 'reject') return { status: 'rejected', reason: 'overload_reject' };
  if (policy === 'drop') return { status: 'dropped', reason: 'overload_drop' };
  return { status: 'deferred', reason: 'overload_defer' };
}

async function enqueueAlert({
  alertId,
  severity,
  tenantKey = '',
  isRetry = false,
  retryCount = 0,
  retryAt = 0,
  jobClass = 'operational',
} = {}) {
  const queueSeverity = QUEUE_KEYS[severity] ? severity : ALERT_SEVERITY.LOW;
  const envelope = normalizeEnvelope({
    alertId,
    severity: queueSeverity,
    tenantKey,
    isRetry,
    retryCount,
    jobClass,
  });
  if (!envelope.alertId) {
    queueMetrics.rejected += 1;
    return { accepted: false, state: 'rejected', reason: 'missing_alert_id' };
  }

  const redis = await ensureRedis();
  const limits = queueLimits();

  if (!(await tenantAllowed(redis, envelope.tenantKey, limits))) {
    queueMetrics.rejected += 1;
    return { accepted: false, state: 'rejected', reason: 'tenant_throttled' };
  }

  if (Number(retryAt || 0) > Date.now()) {
    const scheduledAt = Number(retryAt || 0) + jitterMs(numberEnv('OPS_QUEUE_RETRY_JITTER_MS', 750, 0));
    const payload = JSON.stringify(envelope);
    if (redis && redisAvailable) {
      await redis.zAdd(RETRY_QUEUE_KEYS[queueSeverity], [{ score: scheduledAt, value: payload }]);
    } else if (allowMemoryFallback()) {
      localRetryQueue[queueSeverity].push({ score: scheduledAt, value: payload });
    } else {
      queueMetrics.rejected += 1;
      return { accepted: false, state: 'rejected', reason: 'redis_required_unavailable' };
    }
    queueMetrics.retryScheduled += 1;
    return { accepted: true, state: 'retry_scheduled', reason: '' };
  }

  const depth = await currentDepthBySeverity(redis);
  const admission = decideAdmission(envelope, depth, limits);
  if (admission.status === 'deferred') {
    queueMetrics.deferred += 1;
    return enqueueAlert({
      ...envelope,
      retryAt: Date.now() + numberEnv('OPS_QUEUE_DEFER_MS', 3000, 500),
      isRetry: true,
      retryCount: envelope.retryCount + 1,
    });
  }
  if (admission.status === 'rejected') {
    queueMetrics.rejected += 1;
    return { accepted: false, state: 'rejected', reason: admission.reason };
  }
  if (admission.status === 'dropped') {
    queueMetrics.dropped += 1;
    return { accepted: false, state: 'dropped', reason: admission.reason };
  }

  const payload = JSON.stringify(envelope);
  if (redis && redisAvailable) {
    await redis.rPush(QUEUE_KEYS[queueSeverity], payload);
  } else if (allowMemoryFallback()) {
    localQueue[queueSeverity].push(payload);
  } else {
    queueMetrics.rejected += 1;
    return { accepted: false, state: 'rejected', reason: 'redis_required_unavailable' };
  }
  queueMetrics.enqueued += 1;
  return { accepted: true, state: 'enqueued', reason: admission.reason };
}

async function promoteDueRetries(limit = queueLimits().retryPromotePerTick) {
  const ordered = [ALERT_SEVERITY.CRITICAL, ALERT_SEVERITY.HIGH, ALERT_SEVERITY.MEDIUM, ALERT_SEVERITY.LOW];
  const redis = await ensureRedis();
  const now = Date.now();
  let promoted = 0;
  for (const severity of ordered) {
    if (promoted >= limit) break;
    const left = limit - promoted;
    if (redis && redisAvailable) {
      // eslint-disable-next-line no-await-in-loop
      const due = await redis.zRangeByScore(RETRY_QUEUE_KEYS[severity], 0, now, { LIMIT: { offset: 0, count: left } });
      if (!due.length) continue;
      // eslint-disable-next-line no-await-in-loop
      await redis.zRem(RETRY_QUEUE_KEYS[severity], due);
      // eslint-disable-next-line no-await-in-loop
      await redis.rPush(QUEUE_KEYS[severity], due);
      promoted += due.length;
      continue;
    }
    if (!allowMemoryFallback()) {
      continue;
    }
    const bucket = localRetryQueue[severity];
    bucket.sort((a, b) => a.score - b.score);
    while (bucket.length > 0 && promoted < limit && bucket[0].score <= now) {
      const item = bucket.shift();
      localQueue[severity].push(item.value);
      promoted += 1;
    }
  }
  queueMetrics.retryPromoted += promoted;
  return promoted;
}

async function dequeueAlertDetailed() {
  await promoteDueRetries(queueLimits().retryPromotePerTick);
  const ordered = [ALERT_SEVERITY.CRITICAL, ALERT_SEVERITY.HIGH, ALERT_SEVERITY.MEDIUM, ALERT_SEVERITY.LOW];
  const redis = await ensureRedis();
  if (redis && redisAvailable) {
    for (const severity of ordered) {
      // eslint-disable-next-line no-await-in-loop
      const value = await redis.lPop(QUEUE_KEYS[severity]);
      if (value) {
        const envelope = parseEnvelope(value, severity);
        if (envelope) {
          queueMetrics.dequeued += 1;
          const lag = Math.max(0, Date.now() - Number(envelope.enqueuedAt || Date.now()));
          queueMetrics.dequeueLagMsTotal += lag;
          queueMetrics.dequeueLagSamples += 1;
          return envelope;
        }
      }
    }
    return null;
  }

  for (const severity of ordered) {
    if (!allowMemoryFallback()) {
      break;
    }
    const item = localQueue[severity].shift();
    if (item) {
      const envelope = parseEnvelope(item, severity);
      if (envelope) {
        queueMetrics.dequeued += 1;
        const lag = Math.max(0, Date.now() - Number(envelope.enqueuedAt || Date.now()));
        queueMetrics.dequeueLagMsTotal += lag;
        queueMetrics.dequeueLagSamples += 1;
        return envelope;
      }
    }
  }
  return null;
}

async function dequeueAlert() {
  const details = await dequeueAlertDetailed();
  return details?.alertId || '';
}

async function getQueueHealth() {
  const ordered = [
    ALERT_SEVERITY.CRITICAL,
    ALERT_SEVERITY.HIGH,
    ALERT_SEVERITY.MEDIUM,
    ALERT_SEVERITY.LOW,
  ];
  const redis = await ensureRedis();
  const bySeverity = {};
  let totalDepth = 0;
  let retryBacklog = 0;

  if (redis && redisAvailable) {
    for (const severity of ordered) {
      const depth = Number(await redis.lLen(QUEUE_KEYS[severity])) || 0;
      const retryDepth = Number(await redis.zCard(RETRY_QUEUE_KEYS[severity])) || 0;
      bySeverity[severity] = depth;
      totalDepth += depth;
      retryBacklog += retryDepth;
    }
  } else if (allowMemoryFallback()) {
    for (const severity of ordered) {
      const depth = localQueue[severity].length;
      const retryDepth = localRetryQueue[severity].length;
      bySeverity[severity] = depth;
      totalDepth += depth;
      retryBacklog += retryDepth;
    }
  }

  const limits = queueLimits();
  const saturationPct = Number(((totalDepth / Math.max(1, limits.globalMax)) * 100).toFixed(2));
  const avgDequeueLagMs = queueMetrics.dequeueLagSamples > 0
    ? Math.round(queueMetrics.dequeueLagMsTotal / queueMetrics.dequeueLagSamples)
    : 0;
  const alerts = [];
  if (saturationPct >= numberEnv('OPS_QUEUE_SATURATION_ALERT_PCT', 85, 1)) {
    alerts.push({ code: 'queue_saturation_high', severity: 'warn', value: saturationPct });
  }
  if (retryBacklog >= numberEnv('OPS_QUEUE_RETRY_BACKLOG_ALERT', 300, 1)) {
    alerts.push({ code: 'queue_retry_backlog_high', severity: 'warn', value: retryBacklog });
  }
  if (avgDequeueLagMs >= numberEnv('OPS_QUEUE_LAG_ALERT_MS', 15000, 1000)) {
    alerts.push({ code: 'queue_lag_high', severity: 'warn', value: avgDequeueLagMs });
  }

  return {
    backend: redis && redisAvailable ? 'redis' : 'unavailable',
    totalDepth,
    bySeverity,
    retryBacklog,
    saturationPct,
    avgDequeueLagMs,
    limits,
    overloadPolicy: overloadPolicy(),
    counters: { ...queueMetrics },
    alerts,
  };
}

function getQueueRuntimeStatus() {
  const config = getRedisConfigSummary();
  return {
    configured: config.configured && !config.disabled,
    required: config.required,
    redisAvailable: Boolean(client?.isOpen) && redisAvailable,
    backend: (Boolean(client?.isOpen) && redisAvailable) ? 'redis' : 'unavailable',
  };
}

function getQueueControlSettings() {
  return {
    ...queueLimits(),
    overloadPolicy: overloadPolicy(),
    shedNonCritical: shouldShedNonCritical(),
  };
}

async function closeQueueClient() {
  if (!client) {
    return;
  }
  client = null;
  redisAvailable = false;
}

module.exports = {
  closeQueueClient,
  async initializeOpsQueueRedis() {
    await ensureRedis();
  },
  dequeueAlertDetailed,
  enqueueAlert,
  dequeueAlert,
  getQueueHealth,
  getQueueControlSettings,
  getQueueRuntimeStatus,
  promoteDueRetries,
};
