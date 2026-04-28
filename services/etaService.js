const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const valid = [lat1, lng1, lat2, lng2].every((value) => Number.isFinite(Number(value)));
  if (!valid) return 0;
  const toRad = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

async function mapsEtaMinutes({ origin, destination }) {
  const key = process.env.GOOGLE_MAPS_API_KEY || '';
  if (!key) return null;
  const originText = `${origin.lat},${origin.lng}`;
  const destinationText = `${destination.lat},${destination.lng}`;
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(
    originText,
  )}&destination=${encodeURIComponent(destinationText)}&departure_time=now&key=${encodeURIComponent(key)}`;

  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const payload = await response.json();
    const route = payload?.routes?.[0];
    const leg = route?.legs?.[0];
    const trafficSecs = Number(leg?.duration_in_traffic?.value || 0);
    const durationSecs = Number(leg?.duration?.value || 0);
    const seconds = trafficSecs || durationSecs;
    if (!seconds) return null;
    return Math.max(1, Math.round(seconds / 60));
  } catch (_) {
    return null;
  }
}

function confidenceFromMinutes(minutes, batchPenalty, usedMaps) {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0.35;
  const base = usedMaps ? 0.82 : 0.68;
  const penalty = Math.min(0.25, batchPenalty / 120);
  return Math.max(0.35, Math.min(0.96, base - penalty));
}

async function getEtaForOrder(orderId) {
  const order = await Order.findById(orderId).lean();
  if (!order) {
    const error = new Error('Order not found.');
    error.statusCode = 404;
    throw error;
  }

  const task = await DeliveryTask.findOne({
    orderId: order._id.toString(),
    status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
  }).sort({ createdAt: -1 }).lean();

  if (!task) {
    return {
      orderId: order._id.toString(),
      etaMinutes: null,
      etaTimestamp: '',
      confidence: 0,
      factors: {
        reason: 'no_active_delivery_task',
      },
    };
  }

  const destination = {
    lat: Number(task?.dropLat),
    lng: Number(task?.dropLng),
  };
  const hasDestination =
    Number.isFinite(destination.lat) &&
    Number.isFinite(destination.lng) &&
    !(destination.lat === 0 && destination.lng === 0);
  if (!hasDestination) {
    return {
      orderId: order._id.toString(),
      etaMinutes: null,
      etaTimestamp: '',
      confidence: 0,
      factors: {
        reason: 'missing_drop_coordinates',
        taskId: task._id?.toString?.() || '',
      },
    };
  }

  const origin = {
    lat: Number(order.riderLatitude || task?.currentLocation?.coordinates?.[1] || task?.pickupLat || 0),
    lng: Number(order.riderLongitude || task?.currentLocation?.coordinates?.[0] || task?.pickupLng || 0),
  };

  const distanceKm = haversineDistanceKm(origin.lat, origin.lng, destination.lat, destination.lng);
  const baseHaversineMins = Math.max(3, Math.round((distanceKm / 24) * 60));
  const mapsMinutes = await mapsEtaMinutes({ origin, destination });
  const base = mapsMinutes || baseHaversineMins;

  const activeBatchSize = task?.metadata?.batchSize ? Number(task.metadata.batchSize) : 1;
  const delayFactor = task?.status === 'assigned' ? 6 : task?.status === 'accepted' ? 3 : 1;
  const batchPenalty = Math.max(0, activeBatchSize - 1) * 4;
  const etaMinutes = Math.max(2, Math.round(base + delayFactor + batchPenalty));
  const etaTimestamp = new Date(Date.now() + etaMinutes * 60 * 1000).toISOString();

  return {
    orderId: order._id.toString(),
    etaMinutes,
    etaTimestamp,
    confidence: confidenceFromMinutes(etaMinutes, batchPenalty, Boolean(mapsMinutes)),
    factors: {
      baseMinutes: base,
      delayFactor,
      batchPenalty,
      distanceKm,
      usedMapsApi: Boolean(mapsMinutes),
    },
  };
}

module.exports = {
  getEtaForOrder,
};
