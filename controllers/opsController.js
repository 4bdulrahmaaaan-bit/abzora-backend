const mongoose = require('mongoose');

const OpsAlert = require('../models/OpsAlert');
const OpsActionLog = require('../models/OpsActionLog');
const DeliveryTask = require('../models/DeliveryTask');
const DispatchBatch = require('../models/DispatchBatch');
const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const User = require('../models/User');
const Store = require('../models/Store');
const { isAllowedAdminEmail } = require('./authController');
const { runDetectionCycle } = require('../services/opsRuntimeService');
const { executeAlertAction } = require('../services/opsActionService');
const { getOpsMetrics } = require('../services/opsMetricsService');
const { assignSingleOrder } = require('../services/dispatchEngineService');
const { logOpsAction } = require('../services/opsAuditService');
const { reverseOrderSettlement } = require('../services/financeService');
const { processRazorpayRefund } = require('./orderController');
const { rebuildZones, getZones, setZoneFrozen, zoneIdFromLocation } = require('../services/zoneService');
const { setJson } = require('../services/redisCacheService');

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

    const activeTasks = await DeliveryTask.find({
      orderId,
      status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const [primaryTask, ...duplicateTasks] = activeTasks;

    if (duplicateTasks.length > 0) {
      await DeliveryTask.updateMany(
        { _id: { $in: duplicateTasks.map((task) => task._id) } },
        { $set: { status: 'cancelled', 'metadata.opsManualReassignDuplicate': true } },
      );
    }

    const assigned = await assignSingleOrder({
      orderId,
      actor: { uid: req.user.uid, role: req.user.role },
      replacementTaskId: primaryTask?._id?.toString?.() || '',
      excludedRiderIds: [primaryTask?.riderId].filter(Boolean),
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

    let cancellationRefund = null;
    const shouldAutoRefund =
      (order.paymentMethod || '').toLowerCase() === 'online' &&
      (order.paymentStatus || '').toLowerCase() === 'paid';

    if (shouldAutoRefund) {
      const refundRequest = await RefundRequest.create({
        orderId: order._id,
        userId: order.userId,
        reason: req.body?.reason || 'Order cancelled by ops admin.',
        requestedAmount: Number(order.totalAmount || 0),
        refundedAmount: 0,
        status: 'pending',
      });
      const gatewayRefund = await processRazorpayRefund(order, refundRequest, Number(order.totalAmount || 0));
      refundRequest.status = 'approved';
      refundRequest.processedAt = new Date().toISOString();
      refundRequest.processedBy = req.user.uid;
      refundRequest.gatewayRefundId = gatewayRefund?.id || '';
      refundRequest.refundedAmount = Number(order.totalAmount || 0);
      await refundRequest.save();
      cancellationRefund = refundRequest;

      order.paymentStatus = 'refunded';
      order.refundStatus = 'refunded';
      order.refundRequestId = refundRequest._id.toString();
      order.escrowStatus = 'refunded';
      order.escrowUpdatedAt = new Date().toISOString();
    }

    order.orderStatus = 'cancelled';
    order.deliveryStatus = 'Cancelled';
    await reverseOrderSettlement(order, 'Order cancelled by ops admin');
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
      details: {
        reason: req.body?.reason || 'admin_override',
        refundRequestId: cancellationRefund?._id?.toString?.() || '',
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        orderId,
        refundRequestId: cancellationRefund?._id?.toString?.() || '',
      },
    });
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
    const orderSamples = Array.isArray(req.body?.orders) ? req.body.orders : [];
    const riderSamples = Array.isArray(req.body?.riders) ? req.body.riders : [];
    const orderCount = orderSamples.length > 0
      ? Math.min(orderSamples.length, 5000)
      : Math.max(1, Math.min(5000, Number(req.body?.N || 300)));
    const riderCount = riderSamples.length > 0
      ? Math.min(riderSamples.length, 1000)
      : Math.max(1, Math.min(1000, Number(req.body?.M || 60)));

    let delivered = 0;
    let delayed = 0;
    let dispatchFailures = 0;
    let totalDeliveryMins = 0;

    for (let i = 0; i < orderCount; i += 1) {
      const riderPressure = riderCount / Math.max(1, orderCount);
      const baseDispatchSuccess = Math.max(0.62, Math.min(0.99, 0.75 + riderPressure * 0.35));
      const dispatchOk = Math.random() < baseDispatchSuccess;
      if (!dispatchOk) {
        dispatchFailures += 1;
        continue;
      }
      delivered += 1;
      const duration = randomBetween(22, 110) - Math.min(18, riderPressure * 16);
      totalDeliveryMins += duration;
      if (duration > 75) delayed += 1;
    }

    const ordersPerRider = delivered / Math.max(1, riderCount);
    const riderUtilization = Math.min(1, ordersPerRider / 10);
    const successRate = (orderCount - dispatchFailures) / Math.max(1, orderCount);

    const result = {
      input: {
        orders: orderCount,
        riders: riderCount,
      },
      output: {
        avgDeliveryMinutes: delivered > 0 ? Number((totalDeliveryMins / delivered).toFixed(2)) : 0,
        delayPercent: delivered > 0 ? Number(((delayed / delivered) * 100).toFixed(2)) : 0,
        dispatchSuccessPercent: Number((successRate * 100).toFixed(2)),
        ordersPerRider: Number(ordersPerRider.toFixed(2)),
        utilization: Number((riderUtilization * 100).toFixed(2)),
        successRate: Number((successRate * 100).toFixed(2)),
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

async function listZones(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const city = String(req.query?.city || '').trim();
    const zones = await getZones({ city });
    return res.status(200).json({ success: true, data: zones });
  } catch (error) {
    return next(error);
  }
}

async function refreshZones(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const zones = await rebuildZones();
    return res.status(200).json({ success: true, data: { updated: zones.length, zones } });
  } catch (error) {
    return next(error);
  }
}

async function freezeZone(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const zoneId = String(req.body?.zone_id || req.body?.zoneId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!zoneId) {
      return res.status(400).json({ success: false, message: 'zone_id is required.' });
    }
    const previous = await setZoneFrozen(zoneId, true, reason);
    if (!previous) return res.status(404).json({ success: false, message: 'Zone not found.' });
    await logOpsAction({
      action: 'FREEZE_ZONE',
      status: 'MANUAL',
      entityType: 'zone',
      entityId: zoneId,
      actorId: req.user.uid,
      details: {
        previous_value: { frozen: false },
        new_value: { frozen: true },
        reason,
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(200).json({ success: true, data: previous });
  } catch (error) {
    return next(error);
  }
}

async function unfreezeZone(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const zoneId = String(req.body?.zone_id || req.body?.zoneId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!zoneId) {
      return res.status(400).json({ success: false, message: 'zone_id is required.' });
    }
    const current = await setZoneFrozen(zoneId, false, reason);
    if (!current) return res.status(404).json({ success: false, message: 'Zone not found.' });
    await logOpsAction({
      action: 'UNFREEZE_ZONE',
      status: 'MANUAL',
      entityType: 'zone',
      entityId: zoneId,
      actorId: req.user.uid,
      details: {
        previous_value: { frozen: true },
        new_value: { frozen: false },
        reason,
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(200).json({ success: true, data: current });
  } catch (error) {
    return next(error);
  }
}

async function prioritizeOrder(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderId = String(req.body?.order_id || req.body?.orderId || '').trim();
    const priority = String(req.body?.priority || 'high').trim().toLowerCase();
    const reason = String(req.body?.reason || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Valid order_id is required.' });
    }
    await setJson(`order:${orderId}:priority`, { priority, reason, updatedAt: new Date().toISOString() }, 300);
    await logOpsAction({
      action: 'PRIORITIZE_ORDER',
      status: 'MANUAL',
      entityType: 'order',
      entityId: orderId,
      actorId: req.user.uid,
      details: {
        previous_value: { priority: 'normal' },
        new_value: { priority },
        reason,
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(200).json({ success: true, data: { orderId, priority } });
  } catch (error) {
    return next(error);
  }
}

async function overrideDispatch(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const orderId = String(req.body?.order_id || req.body?.orderId || '').trim();
    const riderId = String(req.body?.rider_id || req.body?.riderId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId) || !riderId) {
      return res.status(400).json({ success: false, message: 'order_id and rider_id are required.' });
    }
    const assigned = await assignSingleOrder({
      orderId,
      actor: { uid: req.user.uid, role: req.user.role },
      preferredRiderId: riderId,
      excludedRiderIds: [],
    });
    await logOpsAction({
      action: 'OVERRIDE_DISPATCH',
      status: 'MANUAL',
      entityType: 'order',
      entityId: orderId,
      actorId: req.user.uid,
      details: {
        requested_rider_id: riderId,
        assigned_rider_id: assigned.riderId,
        reason,
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(200).json({ success: true, data: assigned });
  } catch (error) {
    return next(error);
  }
}

async function getOpsMapDashboard(req, res, next) {
  try {
    if (!ensureOpsAdmin(req, res)) return;
    const city = String(req.query?.city || '').trim();
    const zoneId = String(req.query?.zoneId || '').trim();
    const orderStatus = String(req.query?.orderStatus || '').trim();
    const riderStatus = String(req.query?.riderStatus || '').trim().toLowerCase();
    const severity = String(req.query?.severity || '').trim().toUpperCase();

    const zones = await getZones({ city });

    const riderFilter = { role: 'rider', isActive: true };
    if (city) riderFilter.riderCity = new RegExp(`^${city}$`, 'i');
    if (riderStatus === 'online') riderFilter.riderAvailable = true;
    if (riderStatus === 'offline') riderFilter.riderAvailable = false;

    const orderFilter = {
      orderStatus: { $in: ['confirmed', 'processing', 'shipped'] },
      deliveryStatus: { $in: ['Pending', 'Ready for pickup', 'Assigned', 'Picked up', 'Out for delivery'] },
    };
    if (orderStatus) orderFilter.deliveryStatus = orderStatus;
    const [riders, orders, tasks, alerts] = await Promise.all([
      User.find(riderFilter)
        .select('uid name riderCity riderAvailable latitude longitude riderApprovalStatus')
        .limit(800)
        .lean(),
      Order.find(orderFilter)
        .select('_id storeId orderStatus deliveryStatus riderId totalAmount createdAt updatedAt')
        .sort({ updatedAt: -1 })
        .limit(800)
        .lean(),
      DeliveryTask.find({ status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] } })
        .select('_id orderId riderId storeId status pickupLat pickupLng dropLat dropLng routeDistanceKm routeDurationMins')
        .limit(800)
        .lean(),
      OpsAlert.find({
        status: { $in: ['OPEN', 'QUEUED', 'PROCESSING', 'ESCALATED', 'FAILED'] },
        ...(severity ? { severity } : {}),
      })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

    const storeIds = [...new Set(orders.map((o) => String(o.storeId || '')).filter(Boolean))];
    const stores = await Store.find({ _id: { $in: storeIds } })
      .select('_id name city latitude longitude ownerId')
      .lean();
    const storeMap = new Map(stores.map((s) => [String(s._id), s]));

    const orderMarkers = orders.map((order) => {
      const store = storeMap.get(String(order.storeId || ''));
      const zid = store ? zoneIdFromLocation(store.city, store.latitude, store.longitude) : '';
      return {
        id: String(order._id),
        zoneId: zid,
        lat: Number(store?.latitude || 0),
        lng: Number(store?.longitude || 0),
        orderStatus: order.orderStatus,
        deliveryStatus: order.deliveryStatus,
        riderId: order.riderId || '',
        amount: Number(order.totalAmount || 0),
        updatedAt: order.updatedAt,
      };
    }).filter((m) => !zoneId || m.zoneId === zoneId);

    const riderMarkers = riders.map((rider) => {
      const zid = zoneIdFromLocation(rider.riderCity, rider.latitude, rider.longitude);
      return {
        id: rider.uid,
        name: rider.name || 'Rider',
        zoneId: zid,
        lat: Number(rider.latitude || 0),
        lng: Number(rider.longitude || 0),
        online: Boolean(rider.riderAvailable),
        approval: rider.riderApprovalStatus || '',
      };
    }).filter((m) => !zoneId || m.zoneId === zoneId);

    const dispatchMarkers = tasks.map((task) => ({
      id: String(task._id),
      orderId: task.orderId || '',
      riderId: task.riderId || '',
      zoneId: (() => {
        const store = storeMap.get(String(task.storeId || ''));
        if (!store) return '';
        return zoneIdFromLocation(store.city, store.latitude, store.longitude);
      })(),
      status: task.status,
      pickup: { lat: Number(task.pickupLat || 0), lng: Number(task.pickupLng || 0) },
      drop: { lat: Number(task.dropLat || 0), lng: Number(task.dropLng || 0) },
      routeDistanceKm: Number(task.routeDistanceKm || 0),
      routeDurationMins: Number(task.routeDurationMins || 0),
    })).filter((m) => !zoneId || m.zoneId === zoneId);

    const zoneLayers = zones
      .filter((z) => !zoneId || z.zoneId === zoneId)
      .map((z) => ({
        zoneId: z.zoneId,
        city: z.city,
        center: z.center,
        radiusKm: Number(z.radiusKm || 2.5),
        demandScore: Number(z.demandScore || 0),
        activeOrders: Number(z.activeOrders || 0),
        activeRiders: Number(z.activeRiders || 0),
        frozen: Boolean(z.frozen),
        color: z.demandScore >= 2 ? '#E34D4D' : z.demandScore >= 1 ? '#F0B429' : '#22A06B',
      }));

    const alertFeed = alerts.map((a) => serializeAlert(a));

    return res.status(200).json({
      success: true,
      data: {
        mapLayers: {
          zones: zoneLayers,
          riders: riderMarkers,
          orders: orderMarkers,
          dispatch: dispatchMarkers,
        },
        panels: {
          summary: {
            zones: zoneLayers.length,
            activeOrders: orderMarkers.length,
            activeRiders: riderMarkers.filter((r) => r.online).length,
            activeDispatch: dispatchMarkers.length,
            openAlerts: alertFeed.length,
          },
          zoneStats: zoneLayers,
          alerts: alertFeed,
        },
        filters: {
          city,
          zoneId,
          orderStatus,
          riderStatus: riderStatus || 'all',
          severity: severity || 'ALL',
        },
      },
    });
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
  listZones,
  refreshZones,
  freezeZone,
  unfreezeZone,
  prioritizeOrder,
  overrideDispatch,
  getOpsMapDashboard,
};
