const mongoose = require('mongoose');

const OpsAlert = require('../models/OpsAlert');
const Order = require('../models/Order');
const DeliveryTask = require('../models/DeliveryTask');
const DispatchBatch = require('../models/DispatchBatch');
const { assignSingleOrder } = require('./dispatchEngineService');
const { logOpsAction } = require('./opsAuditService');
const { acquireEntityLock, releaseEntityLock } = require('./opsLockService');
const { ensureEntityMappings } = require('./opsConsistencyService');

function nextBackoffMs(retryCount) {
  return 2000 * Math.pow(2, Math.max(0, retryCount));
}

async function markAlertResolved(alert, details = {}, autoResolved = true) {
  await OpsAlert.updateOne(
    { _id: alert._id },
    {
      $set: {
        status: 'RESOLVED',
        actionStatus: 'DONE',
        resolvedAt: new Date(),
        autoResolved,
        lastError: '',
        payload: {
          ...(alert.payload || {}),
          resolution: details,
        },
      },
    },
  );
}

async function markAlertRetry(alert, error) {
  const nextRetryCount = Number(alert.retryCount || 0) + 1;
  const maxRetries = Number(alert.maxRetries || 3);
  if (nextRetryCount > maxRetries) {
    await OpsAlert.updateOne(
      { _id: alert._id },
      {
        $set: {
          status: 'FAILED',
          actionStatus: 'FAILED',
          lastError: String(error?.message || error || 'Unknown failure'),
          nextRetryAt: null,
        },
      },
    );
    return { exhausted: true, retryCount: nextRetryCount };
  }

  const backoffMs = nextBackoffMs(nextRetryCount);
  await OpsAlert.updateOne(
    { _id: alert._id },
    {
      $set: {
        status: 'QUEUED',
        actionStatus: 'PENDING',
        retryCount: nextRetryCount,
        nextRetryAt: new Date(Date.now() + backoffMs),
        lastError: String(error?.message || error || 'Unknown failure'),
      },
    },
  );
  return { exhausted: false, retryCount: nextRetryCount };
}

async function markAlertManualRequired(alert, details = {}) {
  await OpsAlert.updateOne(
    { _id: alert._id },
    {
      $set: {
        status: 'ESCALATED',
        actionStatus: 'PENDING',
        lastError: '',
        nextRetryAt: null,
        payload: {
          ...(alert.payload || {}),
          resolution: details,
          manualReviewRequired: true,
        },
      },
    },
  );
}

async function cancelOrderFallback(alert) {
  if (!alert.orderId || !mongoose.Types.ObjectId.isValid(alert.orderId)) {
    return { skipped: true };
  }
  const order = await Order.findById(alert.orderId);
  if (!order) return { skipped: true };

  order.orderStatus = 'cancelled';
  order.deliveryStatus = 'Cancelled';
  await order.save();

  await DeliveryTask.updateMany(
    {
      orderId: String(alert.orderId),
      status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
    },
    {
      $set: {
        status: 'cancelled',
        'metadata.opsCancelledByFallback': true,
      },
    },
  );

  await DispatchBatch.updateMany(
    { orderIds: { $in: [String(alert.orderId)] }, status: { $ne: 'completed' } },
    { $set: { status: 'cancelled' } },
  );

  return { cancelled: true };
}

async function reassignOrder(alert, actorId = 'system') {
  const orderId = String(alert.orderId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new Error('Order id is missing for reassignment.');
  }

  const activeTasks = await DeliveryTask.find({
    orderId,
    status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();

  const [primaryTask, ...duplicateTasks] = activeTasks;

  if (duplicateTasks.length > 0) {
    await DeliveryTask.updateMany(
      {
        _id: { $in: duplicateTasks.map((task) => task._id) },
      },
      {
        $set: {
          status: 'cancelled',
          'metadata.opsReassignedDuplicate': true,
        },
      },
    );
  }

  const assigned = await assignSingleOrder({
    orderId,
    actor: { uid: actorId, role: 'admin' },
    replacementTaskId: primaryTask?._id?.toString?.() || '',
    excludedRiderIds: [primaryTask?.riderId].filter(Boolean),
  });
  await ensureEntityMappings({ orderId });
  return assigned;
}

async function retryDispatch(alert) {
  if (!alert.orderId) {
    return { skipped: true };
  }
  return reassignOrder(alert, 'system');
}

async function pingRider(alert) {
  return {
    completed: false,
    pinged: false,
    riderId: alert.riderId || '',
    reason: 'manual_contact_required',
  };
}

async function rerouteOrder(alert) {
  return {
    completed: false,
    rerouted: false,
    orderId: alert.orderId || '',
    reason: 'manual_reroute_required',
  };
}

async function notifyVendor(alert) {
  return {
    completed: false,
    notified: false,
    vendorId: alert.vendorId || '',
    reason: 'manual_vendor_followup_required',
  };
}

async function retryPayment(alert) {
  if (!alert.orderId || !mongoose.Types.ObjectId.isValid(alert.orderId)) {
    return { skipped: true };
  }
  const order = await Order.findById(alert.orderId);
  if (!order) return { skipped: true };
  if (order.paymentStatus === 'paid') return { skipped: true, reason: 'already_paid' };

  order.paymentStatus = 'pending';
  order.lastSettlementError = '';
  order.settlementFailureCount = 0;
  await order.save();

  return {
    completed: false,
    retried: true,
    reason: 'payment_state_reset_only',
  };
}

const actionHandlers = {
  REASSIGN_ORDER: reassignOrder,
  RETRY_DISPATCH: retryDispatch,
  PING_RIDER: pingRider,
  REROUTE_ORDER: rerouteOrder,
  NOTIFY_VENDOR: notifyVendor,
  RETRY_PAYMENT: retryPayment,
  MANUAL_REVIEW: async () => ({ queued: true }),
};

async function executeAlertAction(alert, actorId = 'system') {
  const entityType = alert.entityType || 'order';
  const entityId = alert.entityId || alert.orderId || alert.taskId || alert.alertId;
  const lockOwner = `${actorId}:${alert.alertId}`;

  const acquired = await acquireEntityLock({
    entityType,
    entityId,
    owner: lockOwner,
    ttlMs: 25000,
  });
  if (!acquired) {
    await logOpsAction({
      alertId: alert.alertId,
      action: alert.action,
      status: 'SKIPPED',
      entityType,
      entityId,
      actorId,
      attempt: alert.retryCount,
      details: { reason: 'lock_busy' },
    });
    return { locked: true };
  }

  try {
    await OpsAlert.updateOne(
      { _id: alert._id },
      {
        $set: {
          status: 'PROCESSING',
          actionStatus: 'RUNNING',
          startedAt: new Date(),
        },
      },
    );

    await logOpsAction({
      alertId: alert.alertId,
      action: alert.action,
      status: 'STARTED',
      entityType,
      entityId,
      actorId,
      attempt: alert.retryCount,
    });

    const handler = actionHandlers[alert.action] || actionHandlers.MANUAL_REVIEW;
    const result = await handler(alert, actorId);
    const requiresManualReview = result?.completed === false;

    if (requiresManualReview) {
      await markAlertManualRequired(alert, result);
      await logOpsAction({
        alertId: alert.alertId,
        action: alert.action,
        status: 'ESCALATED',
        entityType,
        entityId,
        actorId,
        attempt: alert.retryCount,
        details: result,
      });
      return { success: false, manual: true, result };
    }

    await markAlertResolved(alert, result, true);
    await logOpsAction({
      alertId: alert.alertId,
      action: alert.action,
      status: 'SUCCESS',
      entityType,
      entityId,
      actorId,
      attempt: alert.retryCount,
      details: result,
    });

    return { success: true, result };
  } catch (error) {
    const retryState = await markAlertRetry(alert, error);

    if (retryState?.exhausted && alert.type === 'STUCK_ORDER') {
      const fallback = await cancelOrderFallback(alert);
      await logOpsAction({
        alertId: alert.alertId,
        action: 'CANCEL_FALLBACK',
        status: 'SUCCESS',
        entityType,
        entityId,
        actorId,
        attempt: retryState.retryCount,
        details: fallback,
      });
      await markAlertResolved(alert, {
        fallback,
        reason: 'max_retries_exhausted',
      });
      return {
        success: false,
        fallbackApplied: true,
        error: error.message,
      };
    }

    await logOpsAction({
      alertId: alert.alertId,
      action: alert.action,
      status: 'FAILED',
      entityType,
      entityId,
      actorId,
      attempt: alert.retryCount,
      error: error.message,
    });
    return { success: false, error: error.message };
  } finally {
    await releaseEntityLock({
      entityType,
      entityId,
      owner: lockOwner,
    });
  }
}

module.exports = {
  executeAlertAction,
  nextBackoffMs,
};
