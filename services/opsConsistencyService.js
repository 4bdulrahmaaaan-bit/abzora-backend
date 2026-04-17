const mongoose = require('mongoose');

const DeliveryTask = require('../models/DeliveryTask');
const DispatchBatch = require('../models/DispatchBatch');
const Order = require('../models/Order');
const OpsAlert = require('../models/OpsAlert');
const { ALERT_TYPES } = require('./opsConstants');
const { computeAlertScore, scoreToSeverity } = require('./opsScoringService');

const ACTIVE_TASK_STATUSES = ['assigned', 'accepted', 'picked_up', 'out_for_delivery'];

async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result = null;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('transaction')) {
      return work(null);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function createConsistencyAlert({ type, entityType, entityId, message, payload = {} }) {
  const score = computeAlertScore({
    timeDelay: 35,
    etaRisk: 15,
    slaImpact: 20,
    orderValue: payload.orderValue || 0,
    userPriority: payload.userPriority || 0,
  });
  const severity = scoreToSeverity(score);
  return OpsAlert.findOneAndUpdate(
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
        status: 'OPEN',
        title: type,
        message,
        entityType,
        entityId,
        payload,
      },
    },
    { upsert: true, new: true },
  );
}

async function ensureEntityMappings({ orderId = '' }) {
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    return { order: null, tasks: [], batch: null, issues: [] };
  }

  const [order, tasks] = await Promise.all([
    Order.findById(orderId),
    DeliveryTask.find({ orderId: String(orderId) }).sort({ createdAt: -1 }),
  ]);
  const issues = [];

  if (!order) {
    const orphanTasks = await DeliveryTask.find({ orderId: String(orderId), status: { $in: ACTIVE_TASK_STATUSES } });
    if (orphanTasks.length > 0) {
      issues.push('orphan_tasks');
      await DeliveryTask.updateMany(
        { _id: { $in: orphanTasks.map((task) => task._id) } },
        { $set: { status: 'cancelled', 'metadata.opsOrphanCancelled': true } },
      );
      await createConsistencyAlert({
        type: ALERT_TYPES.DISPATCH_FAILED,
        entityType: 'order',
        entityId: String(orderId),
        message: 'Orphan delivery tasks were found and cancelled automatically.',
        payload: { orphanTaskCount: orphanTasks.length },
      });
    }
    return { order: null, tasks: [], batch: null, issues };
  }

  const activeTasks = tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status));
  if (activeTasks.length > 1) {
    issues.push('duplicate_active_tasks');
    const keep = activeTasks[0];
    const duplicates = activeTasks.slice(1);
    if (duplicates.length > 0) {
      await DeliveryTask.updateMany(
        { _id: { $in: duplicates.map((task) => task._id) } },
        { $set: { status: 'cancelled', 'metadata.opsDuplicateCancelled': true } },
      );
    }
    if (order.riderId !== keep.riderId) {
      order.riderId = keep.riderId || '';
      order.assignedDeliveryPartner = keep.riderId ? 'Assigned Rider' : 'Unassigned';
      await order.save();
    }
    await createConsistencyAlert({
      type: ALERT_TYPES.STUCK_ORDER,
      entityType: 'order',
      entityId: order._id.toString(),
      message: 'Duplicate active tasks detected. Duplicates were cancelled to preserve consistency.',
      payload: { duplicateTaskCount: duplicates.length },
    });
  }

  let batch = null;
  if (activeTasks.length > 0) {
    batch = await DispatchBatch.findOne({ taskIds: { $in: [activeTasks[0]._id.toString()] } });
  }

  if (batch && activeTasks.length > 0) {
    const task = activeTasks[0];
    if (!batch.orderIds.includes(order._id.toString()) || !batch.taskIds.includes(task._id.toString())) {
      issues.push('batch_mapping_mismatch');
      batch.orderIds = [...new Set([...(batch.orderIds || []), order._id.toString()])];
      batch.taskIds = [...new Set([...(batch.taskIds || []), task._id.toString()])];
      if (!batch.riderId && task.riderId) {
        batch.riderId = task.riderId;
      }
      await batch.save();
    }
  }

  if (activeTasks.length === 1) {
    const currentTask = activeTasks[0];
    if (order.riderId !== currentTask.riderId) {
      issues.push('rider_mapping_mismatch');
      order.riderId = currentTask.riderId || '';
      order.assignedDeliveryPartner = currentTask.riderId ? 'Assigned Rider' : 'Unassigned';
      await order.save();
    }
  }

  return {
    order,
    tasks,
    batch,
    issues,
  };
}

module.exports = {
  ACTIVE_TASK_STATUSES,
  runInTransaction,
  ensureEntityMappings,
};
