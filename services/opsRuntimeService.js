const OpsAlert = require('../models/OpsAlert');
const { detectAndUpsertOperationalAlerts, detectDeadOrdersAndTasks } = require('./opsDetectionService');
const { getWorkerHealth, startOpsWorker, stopOpsWorker } = require('./opsWorkerService');
const { aggregateOpsMetrics } = require('./opsMetricsService');
const { ALERT_SEVERITY } = require('./opsConstants');
const { enqueueAlert } = require('./opsQueueService');

let detectionHandle = null;
let escalationHandle = null;
let metricsHourlyHandle = null;
let metricsDailyHandle = null;

const severityOrder = [
  ALERT_SEVERITY.LOW,
  ALERT_SEVERITY.MEDIUM,
  ALERT_SEVERITY.HIGH,
  ALERT_SEVERITY.CRITICAL,
];

function escalateSeverity(current) {
  const index = Math.max(0, severityOrder.indexOf(current));
  return severityOrder[Math.min(severityOrder.length - 1, index + 1)];
}

async function runDetectionCycle() {
  try {
    const [alerts, dead] = await Promise.all([
      detectAndUpsertOperationalAlerts(),
      detectDeadOrdersAndTasks(),
    ]);

    for (const item of alerts) {
      const alert = item?.alert || item;
      if (!alert || item?.shouldQueue === false) {
        continue;
      }
      await enqueueAlert({
        alertId: alert.alertId,
        severity: alert.severity,
        tenantKey: alert.storeId || alert.userId || '',
        jobClass: alert.type === 'PAYMENT_FAILED' ? 'payment' : 'order',
      });
      await OpsAlert.updateOne(
        { _id: alert._id },
        {
          $set: {
            status: 'QUEUED',
            queuedAt: new Date(),
          },
        },
      );
    }

    if (process.env.NODE_ENV !== 'production') {
      console.log('Ops detection cycle completed', {
        alerts: alerts.length,
        deadMarked: dead.markedCount,
      });
    }
  } catch (error) {
    console.warn('Ops detection cycle failed:', error.message);
  }
}

async function runEscalationCycle() {
  try {
    const thresholdMinutes = Math.max(10, Number(process.env.OPS_ESCALATION_THRESHOLD_MIN || 20));
    const cutoff = new Date(Date.now() - thresholdMinutes * 60000);

    const unresolved = await OpsAlert.find({
      status: { $in: ['OPEN', 'QUEUED', 'ESCALATED'] },
      updatedAt: { $lte: cutoff },
    }).limit(150);

    for (const alert of unresolved) {
      const currentStatus = String(alert.status || '').toUpperCase();
      const escalatedSeverity = escalateSeverity(alert.severity);
      const escalatedScore = Math.min(100, Number(alert.score || 0) + 10);
      const shouldQueue = currentStatus === 'OPEN';
      await OpsAlert.updateOne(
        { _id: alert._id },
        {
          $set: {
            severity: escalatedSeverity,
            score: escalatedScore,
            status: 'ESCALATED',
            actionStatus:
              currentStatus === 'QUEUED' ? 'PENDING' : String(alert.actionStatus || 'PENDING'),
          },
          $inc: {
            escalatedCount: 1,
          },
        },
      );
      if (shouldQueue) {
        await enqueueAlert({
          alertId: alert.alertId,
          severity: escalatedSeverity,
          tenantKey: alert.storeId || alert.userId || '',
          jobClass: alert.type === 'PAYMENT_FAILED' ? 'payment' : 'order',
        });
      }
    }
  } catch (error) {
    console.warn('Ops escalation cycle failed:', error.message);
  }
}

function scheduleMetricsAggregation() {
  const hourlyMs = Math.max(10 * 60 * 1000, Number(process.env.OPS_HOURLY_METRICS_MS || 60 * 60 * 1000));
  const dailyMs = Math.max(60 * 60 * 1000, Number(process.env.OPS_DAILY_METRICS_MS || 24 * 60 * 60 * 1000));

  metricsHourlyHandle = setInterval(() => {
    aggregateOpsMetrics({ type: 'hourly' }).catch((error) => {
      console.warn('Hourly ops metrics aggregation failed:', error.message);
    });
  }, hourlyMs);
  metricsHourlyHandle.unref?.();

  metricsDailyHandle = setInterval(() => {
    aggregateOpsMetrics({ type: 'daily' }).catch((error) => {
      console.warn('Daily ops metrics aggregation failed:', error.message);
    });
  }, dailyMs);
  metricsDailyHandle.unref?.();
}

function startOpsRuntime() {
  if (process.env.OPS_RUNTIME_ENABLED === 'false') {
    return;
  }

  startOpsWorker();

  if (!detectionHandle) {
    const detectionMs = Math.max(15000, Number(process.env.OPS_DETECTION_INTERVAL_MS || 30000));
    detectionHandle = setInterval(runDetectionCycle, detectionMs);
    detectionHandle.unref?.();
    runDetectionCycle().catch(() => null);
  }

  if (!escalationHandle) {
    const escalationMs = Math.max(60000, Number(process.env.OPS_ESCALATION_INTERVAL_MS || 120000));
    escalationHandle = setInterval(runEscalationCycle, escalationMs);
    escalationHandle.unref?.();
  }

  if (!metricsHourlyHandle && !metricsDailyHandle) {
    scheduleMetricsAggregation();
  }
}

function stopOpsRuntime() {
  if (detectionHandle) {
    clearInterval(detectionHandle);
    detectionHandle = null;
  }
  if (escalationHandle) {
    clearInterval(escalationHandle);
    escalationHandle = null;
  }
  if (metricsHourlyHandle) {
    clearInterval(metricsHourlyHandle);
    metricsHourlyHandle = null;
  }
  if (metricsDailyHandle) {
    clearInterval(metricsDailyHandle);
    metricsDailyHandle = null;
  }
  stopOpsWorker();
}

function getOpsRuntimeStatus() {
  return {
    detectionRunning: Boolean(detectionHandle),
    escalationRunning: Boolean(escalationHandle),
    metricsHourlyRunning: Boolean(metricsHourlyHandle),
    metricsDailyRunning: Boolean(metricsDailyHandle),
    worker: getWorkerHealth(),
  };
}

module.exports = {
  getOpsRuntimeStatus,
  startOpsRuntime,
  stopOpsRuntime,
  runDetectionCycle,
  runEscalationCycle,
};
