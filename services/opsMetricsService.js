const OpsAlert = require('../models/OpsAlert');
const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');
const OpsMetricsSnapshot = require('../models/OpsMetricsSnapshot');

function bucketStart(type, date = new Date()) {
  const value = new Date(date);
  if (type === 'daily') {
    value.setHours(0, 0, 0, 0);
    return value;
  }
  value.setMinutes(0, 0, 0);
  return value;
}

async function aggregateOpsMetrics({ type = 'hourly' }) {
  const startAt = bucketStart(type);
  const endAt = new Date(startAt);
  if (type === 'daily') {
    endAt.setDate(endAt.getDate() + 1);
  } else {
    endAt.setHours(endAt.getHours() + 1);
  }

  const [tasks, alerts, orders] = await Promise.all([
    DeliveryTask.find({ createdAt: { $gte: startAt, $lt: endAt } }).lean(),
    OpsAlert.find({ createdAt: { $gte: startAt, $lt: endAt } }).lean(),
    Order.find({ updatedAt: { $gte: startAt, $lt: endAt } }).lean(),
  ]);

  const deliveredTasks = tasks.filter((task) => task.status === 'delivered');
  const delayed = tasks.filter((task) => Boolean(task?.metadata?.opsStuck));
  const dispatchFailures = alerts.filter((alert) => alert.type === 'DISPATCH_FAILED').length;
  const dispatchSuccess = Math.max(0, tasks.length - dispatchFailures);
  const autoResolved = alerts.filter((alert) => alert.autoResolved === true).length;
  const etaRiskCount = alerts.filter((alert) => alert.type === 'ETA_RISK').length;

  const avgDeliveryMinutes = deliveredTasks.length > 0
    ? deliveredTasks.reduce((sum, task) => {
      const createdAt = new Date(task.createdAt || Date.now()).getTime();
      const completedAt = new Date(task.completedAt || task.updatedAt || Date.now()).getTime();
      return sum + Math.max(0, (completedAt - createdAt) / 60000);
    }, 0) / deliveredTasks.length
    : 0;

  const etaAccuracy = orders.length > 0
    ? Math.max(0, 100 - Math.min(90, etaRiskCount * 5))
    : 0;

  const riderDeliveredCount = deliveredTasks.reduce((acc, task) => {
    const key = task.riderId || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const riderEfficiency = Object.keys(riderDeliveredCount).length > 0
    ? Object.values(riderDeliveredCount).reduce((a, b) => a + b, 0) / Object.keys(riderDeliveredCount).length
    : 0;

  const vendorDeliveredCount = deliveredTasks.reduce((acc, task) => {
    const key = task.vendorId || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const vendorEfficiency = Object.keys(vendorDeliveredCount).length > 0
    ? Object.values(vendorDeliveredCount).reduce((a, b) => a + b, 0) / Object.keys(vendorDeliveredCount).length
    : 0;

  const totals = {
    deliveries: deliveredTasks.length,
    delayedDeliveries: delayed.length,
    dispatchSuccess,
    dispatchFailures,
    etaAccuracy,
    autoResolvedAlerts: autoResolved,
    totalAlerts: alerts.length,
    riderEfficiency: Number(riderEfficiency.toFixed(2)),
    vendorEfficiency: Number(vendorEfficiency.toFixed(2)),
    avgDeliveryMinutes: Number(avgDeliveryMinutes.toFixed(2)),
    delayPercent: tasks.length > 0 ? Number(((delayed.length / tasks.length) * 100).toFixed(2)) : 0,
  };

  await OpsMetricsSnapshot.findOneAndUpdate(
    { bucketType: type, bucketStartAt: startAt },
    {
      $set: {
        bucketType: type,
        bucketStartAt: startAt,
        totals,
      },
    },
    { upsert: true },
  );

  return {
    bucketType: type,
    bucketStartAt: startAt,
    totals,
  };
}

async function getOpsMetrics({ type = 'hourly', limit = 24 }) {
  return OpsMetricsSnapshot.find({ bucketType: type })
    .sort({ bucketStartAt: -1 })
    .limit(Math.max(1, Math.min(168, Number(limit || 24))));
}

module.exports = {
  aggregateOpsMetrics,
  getOpsMetrics,
};
