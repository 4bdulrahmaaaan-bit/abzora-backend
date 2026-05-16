const OpsAlert = require('../models/OpsAlert');
const { enqueueAlert, dequeueAlertDetailed, getQueueControlSettings, getQueueHealth } = require('./opsQueueService');
const { executeAlertAction } = require('./opsActionService');
const { WORKER } = require('./opsConstants');

let running = false;
let inFlight = 0;
let retryInFlight = 0;
let loopHandle = null;
const workerHealth = {
  processedCount: 0,
  executionFailures: 0,
  deferredRetries: 0,
  loopFailures: 0,
  emptyDequeues: 0,
  deferredLowPriority: 0,
  retryStormBlocked: 0,
  lastProcessedAt: '',
  lastErrorAt: '',
  lastError: '',
};

async function queueOpenAlerts(limit = 200) {
  const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const openAlerts = await OpsAlert.find({
    status: { $in: ['OPEN', 'ESCALATED'] },
  }).limit(limit * 3);
  openAlerts.sort((left, right) => {
    const sev = (severityWeight[right.severity] || 0) - (severityWeight[left.severity] || 0);
    if (sev !== 0) return sev;
    const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
  });

  for (const alert of openAlerts.slice(0, limit)) {
    await OpsAlert.updateOne(
      { _id: alert._id },
      {
        $set: {
          status: 'QUEUED',
          queuedAt: new Date(),
          actionStatus: 'PENDING',
        },
      },
    );
    const queued = await enqueueAlert({
      alertId: alert.alertId,
      severity: alert.severity,
      tenantKey: alert.storeId || alert.userId || '',
      jobClass: alert.type === 'PAYMENT_FAILED' ? 'payment' : 'order',
    });
    if (!queued.accepted && queued.state === 'deferred') {
      workerHealth.deferredLowPriority += 1;
    }
  }
  return openAlerts.length;
}

async function requeueDueRetries(limit = 120) {
  const now = new Date();
  const due = await OpsAlert.find({
    status: 'QUEUED',
    nextRetryAt: { $ne: null, $lte: now },
    actionStatus: 'PENDING',
  })
    .sort({ nextRetryAt: 1 })
    .limit(limit);

  for (const alert of due) {
    await OpsAlert.updateOne(
      { _id: alert._id },
      {
        $set: {
          nextRetryAt: null,
        },
      },
    );
    await enqueueAlert({
      alertId: alert.alertId,
      severity: alert.severity,
      tenantKey: alert.storeId || alert.userId || '',
      isRetry: true,
      retryCount: Number(alert.retryCount || 0),
      jobClass: alert.type === 'PAYMENT_FAILED' ? 'payment' : 'order',
    });
  }
  return due.length;
}

async function processSingleQueueItem() {
  const queued = await dequeueAlertDetailed();
  if (!queued?.alertId) {
    workerHealth.emptyDequeues += 1;
    return false;
  }
  const alertId = queued.alertId;

  const alert = await OpsAlert.findOne({ alertId: String(alertId) });
  if (!alert || alert.status === 'RESOLVED' || alert.status === 'FAILED') {
    return false;
  }

  if (alert.nextRetryAt && new Date(alert.nextRetryAt).getTime() > Date.now()) {
    workerHealth.deferredRetries += 1;
    // Reliability hardening: deferred retries are re-scheduled into delayed retry queues
    // instead of being dropped when popped too early under race conditions.
    await enqueueAlert({
      alertId: alert.alertId,
      severity: alert.severity,
      tenantKey: alert.storeId || alert.userId || '',
      isRetry: true,
      retryCount: Number(alert.retryCount || 0),
      retryAt: new Date(alert.nextRetryAt).getTime(),
      jobClass: alert.type === 'PAYMENT_FAILED' ? 'payment' : 'order',
    });
    return false;
  }

  if (queued.isRetry) {
    const retryCap = Math.max(1, Number(getQueueControlSettings().retryConcurrencyCap || 1));
    if (retryInFlight >= retryCap) {
      workerHealth.retryStormBlocked += 1;
      await enqueueAlert({
        alertId: alert.alertId,
        severity: alert.severity,
        tenantKey: alert.storeId || alert.userId || '',
        isRetry: true,
        retryCount: Number(alert.retryCount || 0) + 1,
        retryAt: Date.now() + 750,
        jobClass: alert.type === 'PAYMENT_FAILED' ? 'payment' : 'order',
      });
      return false;
    }
    retryInFlight += 1;
  }

  const result = await executeAlertAction(alert, 'ops-worker');
  if (result?.success === false && !result?.manual) {
    workerHealth.executionFailures += 1;
    workerHealth.lastErrorAt = new Date().toISOString();
    workerHealth.lastError = String(result?.error || 'Unknown ops execution failure');
  }
  workerHealth.processedCount += 1;
  workerHealth.lastProcessedAt = new Date().toISOString();
  return true;
}

async function workerLoopTick() {
  if (!running) return;
  const queueHealth = await getQueueHealth();
  const saturationGatePct = Number(process.env.OPS_WORKER_SATURATION_GATE_PCT || 97);
  const overloadProtected = queueHealth.saturationPct >= saturationGatePct;

  await queueOpenAlerts(overloadProtected ? 30 : 100);
  await requeueDueRetries(60);

  while (running && inFlight < WORKER.maxConcurrency) {
    inFlight += 1;
    processSingleQueueItem()
      .catch((error) => {
        workerHealth.loopFailures += 1;
        workerHealth.lastErrorAt = new Date().toISOString();
        workerHealth.lastError = String(error?.message || error || 'Unknown worker loop failure');
        console.warn('Ops worker queue item failed:', workerHealth.lastError);
      })
      .finally(() => {
        retryInFlight = Math.max(0, retryInFlight - 1);
        inFlight = Math.max(0, inFlight - 1);
      });

    if (inFlight >= WORKER.maxConcurrency) {
      break;
    }
  }
}

function startOpsWorker() {
  if (running) return;
  running = true;
  loopHandle = setInterval(workerLoopTick, WORKER.loopIntervalMs);
  loopHandle.unref?.();
}

function stopOpsWorker() {
  running = false;
  if (loopHandle) {
    clearInterval(loopHandle);
    loopHandle = null;
  }
}

function getWorkerHealth() {
  return {
    ...workerHealth,
    running,
    inFlight,
    retryInFlight,
    utilizationPct: Number(((inFlight / Math.max(1, WORKER.maxConcurrency)) * 100).toFixed(2)),
  };
}

module.exports = {
  startOpsWorker,
  stopOpsWorker,
  queueOpenAlerts,
  requeueDueRetries,
  getWorkerHealth,
};
