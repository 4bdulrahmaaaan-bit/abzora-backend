const mongoose = require('mongoose');

const OpsAlert = require('../models/OpsAlert');
const OpsActionLog = require('../models/OpsActionLog');
const DeliveryTask = require('../models/DeliveryTask');
const DispatchBatch = require('../models/DispatchBatch');
const Order = require('../models/Order');
const User = require('../models/User');
const { isAllowedAdminEmail } = require('./authController');
const { runDetectionCycle } = require('../services/opsRuntimeService');
const { executeAlertAction } = require('../services/opsActionService');
const { getOpsMetrics } = require('../services/opsMetricsService');
const { assignSingleOrder } = require('../services/dispatchEngineService');
const { logOpsAction } = require('../services/opsAuditService');

function ensureOpsAdmin(req, res) {
  const privileged = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!privileged || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Ops admin access required.' });
    return false;
  }
  return true;
}

function serializeAlert(item) {
  return {
    id: item._id?.toString?.() || '',
    alertId: item.alertId,
    entityId: item.entityId,
    entityType: item.entityType,
    orderId: item.orderId || '',
    taskId: item.taskId || '',
    type: item.type,
    severity: item.severity,
    score: Number(item.score || 0),
    action: item.action || '',
    status: item.status,
    actionStatus: item.actionStatus,
    retryCount: Number(item.retryCount || 0),
    maxRetries: Number(item.maxRetries || 0),
    message: item.message || '',
    payload: item.payload || {},
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

async function listPriorityAlerts(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit || 50)));
    const filter = {
      status: { $in: ['OPEN', 'QUEUED', 'PROCESSING', 'ESCALATED', 'FAILED'] },
    };
    if (req.query?.severity) {
      filter.severity = String(req.query.severity).trim().toUpperCase();
    }

    const severityWeight = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    const alerts = await OpsAlert.find(filter).limit(limit * 3);
    alerts.sort((left, right) => {
      const sev = (severityWeight[right.severity] || 0) - (severityWeight[left.severity] || 0);
      if (sev !== 0) return sev;
      const scoreDiff = Number(right.score || 0) - Number(left.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    });

    return res.status(200).json({
      success: true,
      data: alerts.slice(0, limit).map(serializeAlert),
    });
  } catch (error) {
    return next(error);
  }
}

async function runOpsDetectionNow(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    await runDetectionCycle();
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function runAlertAction(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const alertId = String(req.params?.alertId || '').trim();
    const alert = await OpsAlert.findOne({ alertId });
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Alert not found.' });
    }

    const output = await executeAlertAction(alert, req.user.uid || 'admin');
    const updated = await OpsAlert.findById(alert._id);

    return res.status(200).json({
      success: true,
      data: {
        output,
        alert: updated ? serializeAlert(updated) : null,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function manualReassignOrder(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }

    await DeliveryTask.updateMany(
      {
        orderId,
        status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
      },
      { $set: { status: 'cancelled', 'metadata.opsManualReassign': true } },
    );

    const assigned = await assignSingleOrder({
      orderId,
      actor: { uid: req.user.uid, role: req.user.role },
    });

    await logOpsAction({
      action: 'MANUAL_REASSIGN',
      status: 'MANUAL',
      entityType: 'order',
      entityId: orderId,
      actorId: req.user.uid,
      details: assigned,
    });

    return res.status(200).json({ success: true, data: assigned });
  } catch (error) {
    return next(error);
  }
}

async function manualCancelOrder(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    order.orderStatus = 'cancelled';
    order.deliveryStatus = 'Cancelled';
    await order.save();

    await DeliveryTask.updateMany(
      { orderId, status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] } },
      { $set: { status: 'cancelled', 'metadata.opsManualCancel': true } },
    );

    await DispatchBatch.updateMany(
      { orderIds: { $in: [orderId] }, status: { $ne: 'completed' } },
      { $set: { status: 'cancelled' } },
    );

    await logOpsAction({
      action: 'MANUAL_CANCEL',
      status: 'MANUAL',
      entityType: 'order',
      entityId: orderId,
      actorId: req.user.uid,
      details: { reason: req.body?.reason || 'admin_override' },
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function manualDispatchOrder(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }
    const assigned = await assignSingleOrder({
      orderId,
      actor: { uid: req.user.uid, role: req.user.role },
    });
    await logOpsAction({
      action: 'FORCE_DISPATCH',
      status: 'MANUAL',
      entityType: 'order',
      entityId: orderId,
      actorId: req.user.uid,
      details: assigned,
    });
    return res.status(200).json({ success: true, data: assigned });
  } catch (error) {
    return next(error);
  }
}

async function manualRetryPayment(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }
    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    order.paymentStatus = 'pending';
    order.lastSettlementError = '';
    order.settlementFailureCount = 0;
    await order.save();

    await logOpsAction({
      action: 'MANUAL_PAYMENT_RETRY',
      status: 'MANUAL',
      entityType: 'order',
      entityId: orderId,
      actorId: req.user.uid,
    });

    return res.status(200).json({ success: true, data: { paymentStatus: order.paymentStatus } });
  } catch (error) {
    return next(error);
  }
}

async function getOpsLogs(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const limit = Math.max(1, Math.min(400, Number(req.query?.limit || 100)));
    const logs = await OpsActionLog.find({}).sort({ createdAt: -1 }).limit(limit);
    return res.status(200).json({ success: true, data: logs });
  } catch (error) {
    return next(error);
  }
}

async function getOpsMetricsDashboard(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const type = String(req.query?.type || 'hourly').trim().toLowerCase() === 'daily' ? 'daily' : 'hourly';
    const limit = Math.max(1, Math.min(168, Number(req.query?.limit || 24)));
    const snapshots = await getOpsMetrics({ type, limit });
    return res.status(200).json({ success: true, data: snapshots });
  } catch (error) {
    return next(error);
  }
}

async function getOpsLivePanel(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;

    const [liveOrders, liveRiders, liveVendors, liveDispatch, alertCounts] = await Promise.all([
      Order.find({ orderStatus: { $in: ['confirmed', 'processing', 'shipped'] } }).sort({ updatedAt: -1 }).limit(200),
      User.find({ role: 'rider', isActive: true }).select('uid name riderApprovalStatus riderCity riderAvailable latitude longitude').limit(300),
      User.find({ role: 'vendor', isActive: true }).select('uid name storeId city').limit(300),
      DeliveryTask.find({ status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] } }).sort({ updatedAt: -1 }).limit(300),
      OpsAlert.aggregate([
        { $match: { status: { $in: ['OPEN', 'QUEUED', 'PROCESSING', 'ESCALATED', 'FAILED'] } } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        liveOrders,
        riders: liveRiders,
        vendors: liveVendors,
        dispatch: liveDispatch,
        alertCounts,
      },
    });
  } catch (error) {
    return next(error);
  }
}

function randomBetween(min, max) {
  return Math.random() * (max - min) + min;
}

async function runOpsSimulation(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderCount = Math.max(1, Math.min(5000, Number(req.body?.orders || req.body?.N || 300)));
    const riderCount = Math.max(1, Math.min(1000, Number(req.body?.riders || req.body?.M || 60)));

    let delivered = 0;
    let delayed = 0;
    let dispatchFailures = 0;
    let totalDeliveryMins = 0;
    let riderUtilization = 0;

    for (let i = 0; i < orderCount; i += 1) {
      const baseDispatchSuccess = Math.max(0.7, Math.min(0.98, 0.88 + (riderCount - orderCount / 8) / 1000));
      const dispatchOk = Math.random() < baseDispatchSuccess;
      if (!dispatchOk) {
        dispatchFailures += 1;
        continue;
      }
      delivered += 1;

      const duration = randomBetween(18, 95);
      totalDeliveryMins += duration;
      if (duration > 60) {
        delayed += 1;
      }
    }

    riderUtilization = orderCount > 0 ? Math.min(1, delivered / Math.max(1, riderCount * 10)) : 0;

    const result = {
      input: {
        orders: orderCount,
        riders: riderCount,
      },
      output: {
        avgDeliveryMinutes: delivered > 0 ? Number((totalDeliveryMins / delivered).toFixed(2)) : 0,
        delayPercent: delivered > 0 ? Number(((delayed / delivered) * 100).toFixed(2)) : 0,
        dispatchSuccessPercent: Number((((orderCount - dispatchFailures) / orderCount) * 100).toFixed(2)),
        efficiencyScore: Number((Math.max(0, 100 - (delayed / Math.max(1, delivered)) * 70 + riderUtilization * 20)).toFixed(2)),
        delivered,
        delayed,
        dispatchFailures,
      },
    };

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listPriorityAlerts,
  runOpsDetectionNow,
  runAlertAction,
  manualReassignOrder,
  manualCancelOrder,
  manualDispatchOrder,
  manualRetryPayment,
  getOpsLogs,
  getOpsMetricsDashboard,
  getOpsLivePanel,
  runOpsSimulation,
};
