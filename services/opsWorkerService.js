const OpsAlert = require('../models/OpsAlert');
const { enqueueAlert, dequeueAlert } = require('./opsQueueService');
const { executeAlertAction } = require('./opsActionService');
const { WORKER } = require('./opsConstants');

let running = false;
let inFlight = 0;
let loopHandle = null;

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
    await enqueueAlert({
      alertId: alert.alertId,
      severity: alert.severity,
    });
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
    await enqueueAlert({ alertId: alert.alertId, severity: alert.severity });
  }
  return due.length;
}

async function processSingleQueueItem() {
  const alertId = await dequeueAlert();
  if (!alertId) return false;

  const alert = await OpsAlert.findOne({ alertId: String(alertId) });
  if (!alert || alert.status === 'RESOLVED' || alert.status === 'FAILED') {
    return false;
  }

  if (alert.nextRetryAt && new Date(alert.nextRetryAt).getTime() > Date.now()) {
    await enqueueAlert({ alertId: alert.alertId, severity: alert.severity });
    return false;
  }

  await executeAlertAction(alert, 'ops-worker');
  return true;
}

async function workerLoopTick() {
  if (!running) return;

  await queueOpenAlerts(100);
  await requeueDueRetries(60);

  while (running && inFlight < WORKER.maxConcurrency) {
    inFlight += 1;
    processSingleQueueItem()
      .catch(() => null)
      .finally(() => {
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

module.exports = {
  startOpsWorker,
  stopOpsWorker,
  queueOpenAlerts,
  requeueDueRetries,
};
