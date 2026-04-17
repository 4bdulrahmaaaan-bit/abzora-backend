const TrackingLog = require('../models/TrackingLog');
const { publishTrackingEvent } = require('./trackingGateway');

function toCoord(lat, lng) {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return {
    type: 'Point',
    coordinates: [longitude, latitude],
  };
}

async function recordTrackingEvent({
  eventType,
  orderId = '',
  taskId = '',
  riderId = '',
  userId = '',
  vendorId = '',
  latitude = null,
  longitude = null,
  payload = {},
  eventAt = null,
}) {
  const coordinates = toCoord(latitude, longitude);
  const log = await TrackingLog.create({
    eventType,
    orderId: String(orderId || '').trim(),
    taskId: String(taskId || '').trim(),
    riderId: String(riderId || '').trim(),
    userId: String(userId || '').trim(),
    vendorId: String(vendorId || '').trim(),
    coordinates: coordinates || undefined,
    payload: payload && typeof payload === 'object' ? payload : {},
    eventAt: eventAt ? new Date(eventAt) : new Date(),
  });

  await publishTrackingEvent({
    eventType,
    orderId,
    taskId,
    riderId,
    userId,
    data: payload || {},
  });

  return log;
}

module.exports = {
  recordTrackingEvent,
};
