const mongoose = require('mongoose');

const Order = require('../models/Order');
const DeliveryTask = require('../models/DeliveryTask');
const OpsAlert = require('../models/OpsAlert');
const { ALERT_TYPES, TIMEOUTS_MINUTES } = require('./opsConstants');
const { computeAlertScore, scoreToSeverity } = require('./opsScoringService');
const { ensureEntityMappings } = require('./opsConsistencyService');

function asDate(input) {
  if (!input) return null;
  const value = new Date(input);
  return Number.isNaN(value.getTime()) ? null : value;
}

function ageMinutes(from) {
  if (!from) return 0;
  return Math.max(0, Math.round((Date.now() - from.getTime()) / 60000));
}

function resolveAlertEntity({ order, task, type }) {
  if (task) {
    return {
      entityType: 'task',
      entityId: task._id.toString(),
      orderId: task.orderId || order?._id?.toString?.() || '',
      taskId: task._id.toString(),
      riderId: task.riderId || '',
      vendorId: task.vendorId || '',
    };
  }
  return {
    entityType: 'order',
    entityId: order._id.toString(),
    orderId: order._id.toString(),
    taskId: '',
    riderId: order.riderId || '',
    vendorId: '',
    type,
  };
}

function buildAlertScore({ delayMins, orderValue, priorityBoost = 0 }) {
  return computeAlertScore({
    timeDelay: Math.min(50, Math.round(delayMins / 2)),
    etaRisk: Math.min(20, Math.round(delayMins / 4)),
    slaImpact: Math.min(20, Math.round(delayMins / 3)),
    orderValue,
    userPriority: priorityBoost,
  });
}

async function upsertOpenAlert({
  type,
  title,
  message,
  score,
  payload,
  entityType,
  entityId,
  orderId = '',
  taskId = '',
  riderId = '',
  vendorId = '',
}) {
  const severity = scoreToSeverity(score);
  const actionMap = {
    STUCK_ORDER: 'REASSIGN_ORDER',
    DELAYED_ORDER: 'REROUTE_ORDER',
    RIDER_INACTIVE: 'PING_RIDER',
    DISPATCH_FAILED: 'RETRY_DISPATCH',
    ETA_RISK: 'REROUTE_ORDER',
    VENDOR_DELAY: 'NOTIFY_VENDOR',
    PAYMENT_FAILED: 'RETRY_PAYMENT',
  };
  const alert = await OpsAlert.findOneAndUpdate(
    {
      type,
      entityType,
      entityId,
      status: { $in: ['OPEN', 'QUEUED', 'PROCESSING', 'ESCALATED'] },
    },
    {
      $setOnInsert: {
        alertId: `ops_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      },
      $set: {
        score,
        severity,
        title,
        message,
        payload,
        orderId,
        taskId,
        riderId,
        vendorId,
        status: 'OPEN',
        action: actionMap[type] || 'MANUAL_REVIEW',
        actionStatus: 'PENDING',
        maxRetries: Math.min(3, Math.max(2, Number(process.env.OPS_ACTION_MAX_RETRIES || 3))),
      },
    },
    { upsert: true, new: true },
  );
  return alert;
}

async function detectAndUpsertOperationalAlerts() {
  const now = new Date();
  const created = [];

  const vendorDelayedOrders = await Order.find({
    orderStatus: { $in: ['confirmed', 'processing'] },
    deliveryStatus: { $in: ['Pending', 'Ready for pickup'] },
    createdAt: { $lte: new Date(now.getTime() - TIMEOUTS_MINUTES.vendorAccept * 60000) },
  })
    .sort({ createdAt: 1 })
    .limit(200)
    .lean();

  for (const order of vendorDelayedOrders) {
    const delayMins = ageMinutes(asDate(order.createdAt));
    const score = buildAlertScore({
      delayMins,
      orderValue: Number(order.totalAmount || 0),
      priorityBoost: 8,
    });
    const entity = resolveAlertEntity({ order, task: null, type: ALERT_TYPES.VENDOR_DELAY });
    const alert = await upsertOpenAlert({
      type: ALERT_TYPES.VENDOR_DELAY,
      title: 'Vendor acceptance timeout',
      message: 'Vendor confirmation exceeded configured timeout.',
      score,
      payload: {
        timeoutMinutes: TIMEOUTS_MINUTES.vendorAccept,
        delayMins,
      },
      ...entity,
    });
    created.push(alert);
  }

  const stuckTasks = await DeliveryTask.find({
    status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
    updatedAt: { $lte: new Date(now.getTime() - 20 * 60000) },
  })
    .sort({ updatedAt: 1 })
    .limit(300)
    .lean();

  for (const task of stuckTasks) {
    const updatedAt = asDate(task.updatedAt) || asDate(task.createdAt);
    const delayMins = ageMinutes(updatedAt);

    let type = ALERT_TYPES.STUCK_ORDER;
    if (task.status === 'assigned' && delayMins >= TIMEOUTS_MINUTES.riderAccept) {
      type = ALERT_TYPES.DISPATCH_FAILED;
    } else if (task.status === 'accepted' && delayMins >= TIMEOUTS_MINUTES.pickup) {
      type = ALERT_TYPES.RIDER_INACTIVE;
    } else if ((task.status === 'picked_up' || task.status === 'out_for_delivery') && delayMins >= TIMEOUTS_MINUTES.delivery) {
      type = ALERT_TYPES.DELAYED_ORDER;
    }

    const score = buildAlertScore({
      delayMins,
      orderValue: Number(task?.metadata?.orderTotal || 0),
      priorityBoost: type === ALERT_TYPES.STUCK_ORDER ? 20 : 10,
    });

    const alert = await upsertOpenAlert({
      type,
      title: `Task timeout: ${task.status}`,
      message: `Task has been inactive for ${delayMins} minutes and is marked as stuck.`,
      score,
      payload: {
        taskStatus: task.status,
        delayMins,
        timeoutMinutes:
          type === ALERT_TYPES.DISPATCH_FAILED
            ? TIMEOUTS_MINUTES.riderAccept
            : type === ALERT_TYPES.RIDER_INACTIVE
              ? TIMEOUTS_MINUTES.pickup
              : TIMEOUTS_MINUTES.delivery,
      },
      entityType: 'task',
      entityId: task._id.toString(),
      orderId: task.orderId || '',
      taskId: task._id.toString(),
      riderId: task.riderId || '',
      vendorId: task.vendorId || '',
    });

    await DeliveryTask.updateOne(
      { _id: task._id },
      { $set: { 'metadata.opsStuck': true, 'metadata.opsStuckAt': new Date().toISOString() } },
    );
    if (task.orderId) {
      await ensureEntityMappings({ orderId: task.orderId });
    }
    created.push(alert);
  }

  const paymentFailedOrders = await Order.find({
    paymentStatus: 'failed',
    orderStatus: { $ne: 'cancelled' },
    updatedAt: { $gte: new Date(now.getTime() - 6 * 60 * 60000) },
  })
    .limit(150)
    .lean();

  for (const order of paymentFailedOrders) {
    const delayMins = ageMinutes(asDate(order.updatedAt));
    const score = buildAlertScore({
      delayMins,
      orderValue: Number(order.totalAmount || 0),
      priorityBoost: 12,
    });
    const alert = await upsertOpenAlert({
      type: ALERT_TYPES.PAYMENT_FAILED,
      title: 'Payment failed',
      message: 'Payment failed and requires retry or manual intervention.',
      score,
      payload: {
        delayMins,
      },
      entityType: 'order',
      entityId: order._id.toString(),
      orderId: order._id.toString(),
      taskId: '',
      riderId: order.riderId || '',
      vendorId: '',
    });
    created.push(alert);
  }

  return created;
}

async function detectDeadOrdersAndTasks() {
  const thresholdMins = Math.max(15, Number(process.env.OPS_DEAD_THRESHOLD_MIN || 35));
  const cutoff = new Date(Date.now() - thresholdMins * 60000);
  const deadTasks = await DeliveryTask.find({
    status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
    updatedAt: { $lte: cutoff },
  })
    .sort({ updatedAt: 1 })
    .limit(150);

  const marked = [];
  for (const task of deadTasks) {
    task.metadata = {
      ...(task.metadata && typeof task.metadata === 'object' ? task.metadata : {}),
      opsDead: true,
      opsDeadAt: new Date().toISOString(),
    };
    await task.save();
    marked.push(task._id.toString());
    await upsertOpenAlert({
      type: ALERT_TYPES.STUCK_ORDER,
      title: 'Dead task detected',
      message: 'Task crossed dead-order threshold and was flagged for reassignment.',
      score: 82,
      payload: { deadThresholdMins: thresholdMins },
      entityType: 'task',
      entityId: task._id.toString(),
      orderId: task.orderId || '',
      taskId: task._id.toString(),
      riderId: task.riderId || '',
      vendorId: task.vendorId || '',
    });
  }

  return {
    thresholdMins,
    markedCount: marked.length,
    markedTaskIds: marked,
  };
}

module.exports = {
  detectAndUpsertOperationalAlerts,
  detectDeadOrdersAndTasks,
};
