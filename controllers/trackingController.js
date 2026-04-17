const mongoose = require('mongoose');

const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');
const User = require('../models/User');
const { getEtaForOrder } = require('../services/etaService');
const { recordTrackingEvent } = require('../services/trackingEventService');
const TrackingLog = require('../models/TrackingLog');

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
    if (req.user.role === 'rider') {
      riderId = req.user.uid;
    }

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

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const actorCanWrite =
      ['admin', 'super_admin'].includes(req.user.role) ||
      req.user.uid === order.riderId ||
      req.user.uid === order.userId;
    if (!actorCanWrite) {
      return res.status(403).json({ success: false, message: 'Status update access denied.' });
    }

    await recordTrackingEvent({
      eventType: 'order_status_update',
      orderId: order._id.toString(),
      riderId: order.riderId || '',
      userId: order.userId || '',
      payload: {
        status,
        actorId: req.user.uid,
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
