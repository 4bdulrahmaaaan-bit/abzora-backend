const mongoose = require('mongoose');

const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');
const User = require('../models/User');
const { getEtaForOrder } = require('../services/etaService');
const { recordTrackingEvent } = require('../services/trackingEventService');
const TrackingLog = require('../models/TrackingLog');
const { hasRole } = require('../middleware/authorizationMiddleware');
const { settleDeliveredOrder } = require('../services/financeService');

function isVendorUser(user) {
  return hasRole(user, ['vendor']);
}

function isRiderUser(user) {
  return hasRole(user, ['rider']);
}

function isAdminUser(user) {
  return hasRole(user, ['admin', 'super_admin']);
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const values = [lat1, lng1, lat2, lng2].map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    return 0;
  }
  const [aLat, aLng, bLat, bLng] = values;
  const toRad = (value) => (value * Math.PI) / 180;
  const radiusMeters = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const p =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * radiusMeters * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));
}

function validateTrackingSpeed({
  previous,
  currentLatitude,
  currentLongitude,
  requestedSpeedKmph,
}) {
  const maxSpeed = Math.max(60, Number(process.env.TRACKING_MAX_SPEED_KMPH || 120));
  if (Number.isFinite(requestedSpeedKmph) && requestedSpeedKmph > maxSpeed) {
    return { allowed: false, reason: 'speed_limit_exceeded' };
  }
  if (!previous) {
    return { allowed: true };
  }
  const prevCoordinates = previous.coordinates?.coordinates || [];
  if (!Array.isArray(prevCoordinates) || prevCoordinates.length !== 2) {
    return { allowed: true };
  }
  const [prevLng, prevLat] = prevCoordinates;
  const distanceMeters = haversineMeters(prevLat, prevLng, currentLatitude, currentLongitude);
  const elapsedSeconds = Math.max(
    1,
    (Date.now() - new Date(previous.eventAt || previous.createdAt || Date.now()).getTime()) / 1000,
  );
  const inferredSpeedKmph = (distanceMeters / elapsedSeconds) * 3.6;
  if (inferredSpeedKmph > maxSpeed * 1.2) {
    return { allowed: false, reason: 'inferred_speed_invalid' };
  }
  return { allowed: true, distanceMeters, elapsedSeconds, inferredSpeedKmph };
}

async function shouldAcceptLocationUpdate({
  orderId,
  taskId,
  riderId,
  latitude,
  longitude,
  speedKmph,
}) {
  const scopeFilter = taskId
    ? { taskId }
    : orderId
      ? { orderId }
      : riderId
        ? { riderId }
        : {};
  const previous = await TrackingLog.findOne({
    eventType: 'location_update',
    ...scopeFilter,
  }).sort({ eventAt: -1 });

  const throttleSeconds = Math.max(3, Math.min(5, Number(process.env.TRACKING_THROTTLE_SECONDS || 4)));
  if (previous) {
    const elapsed = (Date.now() - new Date(previous.eventAt || previous.createdAt || Date.now()).getTime()) / 1000;
    if (elapsed < throttleSeconds) {
      return { accept: false, reason: 'throttled', previous };
    }
  }

  const movementThresholdMeters = Math.max(10, Math.min(20, Number(process.env.TRACKING_MOVEMENT_THRESHOLD_METERS || 12)));
  if (previous && Array.isArray(previous.coordinates?.coordinates) && previous.coordinates.coordinates.length === 2) {
    const [prevLng, prevLat] = previous.coordinates.coordinates;
    const movementMeters = haversineMeters(prevLat, prevLng, latitude, longitude);
    if (movementMeters < movementThresholdMeters) {
      return { accept: false, reason: 'movement_below_threshold', movementMeters, previous };
    }
  }

  const speedValidation = validateTrackingSpeed({
    previous,
    currentLatitude: latitude,
    currentLongitude: longitude,
    requestedSpeedKmph: speedKmph,
  });
  if (!speedValidation.allowed) {
    return { accept: false, reason: speedValidation.reason, previous };
  }
  return { accept: true, previous };
}

function maybeSnapToRoad(latitude, longitude) {
  if (process.env.TRACKING_SNAP_TO_ROAD !== 'true') {
    return { latitude, longitude, snapped: false };
  }
  // Placeholder for map provider integration. Keeps current coordinates until provider is enabled.
  return { latitude, longitude, snapped: false };
}

function ensureTrackingAccess(req, res) {
  if (!req.user?.uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

async function resolveTrackingScope({ orderId, taskId }) {
  let order = null;
  let task = null;
  if (taskId && mongoose.Types.ObjectId.isValid(taskId)) {
    task = await DeliveryTask.findById(taskId);
  }
  if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
    order = await Order.findById(orderId);
  } else if (task?.orderId && mongoose.Types.ObjectId.isValid(task.orderId)) {
    order = await Order.findById(task.orderId);
  }
  return { order, task };
}

function canReadTracking(req, order) {
  if (!order || !req.user?.uid) {
    return false;
  }
  if (isAdminUser(req.user)) {
    return true;
  }
  if (req.user.uid === order.userId || req.user.uid === order.riderId) {
    return true;
  }
  return isVendorUser(req.user) && String(req.user.storeId || '') === String(order.storeId || '');
}

function canWriteTracking(req, order, task, riderId) {
  if (!req.user?.uid) {
    return false;
  }
  if (isAdminUser(req.user)) {
    return true;
  }
  if (isRiderUser(req.user)) {
    return String(req.user.uid) === String(riderId || order?.riderId || task?.riderId || '');
  }
  return false;
}

function normalizeDeliveryStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  const map = {
    assigned: 'Assigned',
    accepted: 'Assigned',
    'picked up': 'Picked up',
    picked_up: 'Picked up',
    'out for delivery': 'Out for delivery',
    out_for_delivery: 'Out for delivery',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    canceled: 'Cancelled',
  };
  return map[normalized] || '';
}

function taskStatusForDeliveryStatus(status) {
  switch (status) {
    case 'Assigned':
      return 'assigned';
    case 'Picked up':
      return 'picked_up';
    case 'Out for delivery':
      return 'out_for_delivery';
    case 'Delivered':
      return 'delivered';
    case 'Cancelled':
      return 'cancelled';
    default:
      return '';
  }
}

function orderStatusForDeliveryStatus(status, currentOrderStatus) {
  switch (status) {
    case 'Assigned':
      return currentOrderStatus || 'confirmed';
    case 'Picked up':
      return 'processing';
    case 'Out for delivery':
      return 'shipped';
    case 'Delivered':
      return 'delivered';
    case 'Cancelled':
      return 'cancelled';
    default:
      return currentOrderStatus || '';
  }
}

async function postLocationUpdate(req, res, next) {
  try {
    if (!ensureTrackingAccess(req, res)) return;
    const orderId = String(req.body?.orderId || '').trim();
    const taskId = String(req.body?.taskId || '').trim();
    const latitude = Number(req.body?.latitude);
    const longitude = Number(req.body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required.' });
    }

    let riderId = String(req.body?.riderId || req.user.uid || '').trim();
    if (isRiderUser(req.user)) {
      riderId = req.user.uid;
    }
    const { order, task } = await resolveTrackingScope({ orderId, taskId });
    if ((orderId && !order) || (taskId && !task)) {
      return res.status(404).json({ success: false, message: 'Tracking target not found.' });
    }
    if (!canWriteTracking(req, order, task, riderId)) {
      return res.status(403).json({ success: false, message: 'Location update access denied.' });
    }
    riderId = String(riderId || task?.riderId || order?.riderId || '').trim();

    const requestedSpeedKmph = Number(req.body?.speedKmph || 0);
    const gate = await shouldAcceptLocationUpdate({
      orderId,
      taskId,
      riderId,
      latitude,
      longitude,
      speedKmph: requestedSpeedKmph,
    });
    if (!gate.accept) {
      return res.status(202).json({
        success: true,
        ignored: true,
        reason: gate.reason,
      });
    }

    const snapped = maybeSnapToRoad(latitude, longitude);

    if (riderId) {
      await User.updateOne(
        { uid: riderId },
        {
          $set: {
            latitude: snapped.latitude,
            longitude: snapped.longitude,
            liveLocation: {
              type: 'Point',
              coordinates: [snapped.longitude, snapped.latitude],
            },
            locationUpdatedAt: new Date().toISOString(),
          },
        },
      );
    }
    if (taskId && mongoose.Types.ObjectId.isValid(taskId)) {
      await DeliveryTask.updateOne(
        { _id: taskId },
        {
          $set: {
            currentLocation: {
              type: 'Point',
              coordinates: [snapped.longitude, snapped.latitude],
            },
            updatedAt: new Date(),
          },
        },
      );
    }
    if (orderId && mongoose.Types.ObjectId.isValid(orderId)) {
      await Order.updateOne(
        { _id: orderId },
        {
          $set: {
            riderLongitude: snapped.longitude,
            riderLatitude: snapped.latitude,
            riderLocationUpdatedAt: new Date().toISOString(),
          },
        },
      );
    }

    const log = await recordTrackingEvent({
      eventType: 'location_update',
      orderId,
      taskId,
      riderId,
      latitude: snapped.latitude,
      longitude: snapped.longitude,
      payload: {
        speedKmph: requestedSpeedKmph,
        heading: Number(req.body?.heading || 0),
        snappedToRoad: snapped.snapped,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        id: log._id.toString(),
        eventType: log.eventType,
        eventAt: log.eventAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function postOrderStatusUpdate(req, res, next) {
  try {
    if (!ensureTrackingAccess(req, res)) return;
    const orderId = String(req.body?.orderId || '').trim();
    const status = String(req.body?.status || '').trim();
    if (!orderId || !mongoose.Types.ObjectId.isValid(orderId) || !status) {
      return res.status(400).json({ success: false, message: 'orderId and status are required.' });
    }

    let order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const normalizedStatus = normalizeDeliveryStatus(status);
    if (!normalizedStatus) {
      return res.status(400).json({ success: false, message: 'Unsupported delivery status.' });
    }
    const actorCanWrite =
      isAdminUser(req.user) ||
      (isRiderUser(req.user) && req.user.uid === order.riderId);
    if (!actorCanWrite) {
      return res.status(403).json({ success: false, message: 'Status update access denied.' });
    }

    const task = await DeliveryTask.findOne({
      orderId: order._id.toString(),
      status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
    }).sort({ createdAt: -1 });

    order.deliveryStatus = normalizedStatus;
    order.orderStatus = orderStatusForDeliveryStatus(normalizedStatus, order.orderStatus);
    if (normalizedStatus === 'Delivered' && (order.paymentMethod || '').toUpperCase() === 'COD') {
      order.paymentStatus = 'paid';
    }
    order.riderLocationUpdatedAt = order.riderLocationUpdatedAt || new Date().toISOString();
    const shouldSettleDelivered = normalizedStatus === 'Delivered';
    await order.save();
    if (shouldSettleDelivered) {
      await settleDeliveredOrder(order);
      order = await Order.findById(order._id);
    }

    if (task) {
      task.status = taskStatusForDeliveryStatus(normalizedStatus) || task.status;
      await task.save();
    }

    await recordTrackingEvent({
      eventType: 'order_status_update',
      orderId: order._id.toString(),
      riderId: order.riderId || '',
      userId: order.userId || '',
      payload: {
        status: normalizedStatus,
        taskStatus: task?.status || '',
        actorId: req.user.uid,
        orderStatus: order.orderStatus,
      },
    });
    return res.status(200).json({ success: true });
  } catch (error) {
    return next(error);
  }
}

async function getOrderEtaLive(req, res, next) {
  try {
    if (!ensureTrackingAccess(req, res)) return;
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }
    const order = await Order.findById(orderId).select('userId riderId storeId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    if (!canReadTracking(req, order)) {
      return res.status(403).json({ success: false, message: 'ETA access denied.' });
    }
    const eta = await getEtaForOrder(orderId);
    await recordTrackingEvent({
      eventType: 'eta_update',
      orderId,
      riderId: '',
      payload: eta,
    });
    return res.status(200).json({ success: true, data: eta });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  postLocationUpdate,
  postOrderStatusUpdate,
  getOrderEtaLive,
};
