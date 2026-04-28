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
  const trackingPayload = payload && typeof payload === 'object' ? { ...payload } : {};
  const log = await TrackingLog.create({
    eventType,
    orderId: String(orderId || '').trim(),
    taskId: String(taskId || '').trim(),
    riderId: String(riderId || '').trim(),
    userId: String(userId || '').trim(),
    vendorId: String(vendorId || '').trim(),
    coordinates: coordinates || undefined,
    payload: trackingPayload,
    eventAt: eventAt ? new Date(eventAt) : new Date(),
  });

  try {
    const publishResult = await publishTrackingEvent({
      eventType,
      orderId,
      taskId,
      riderId,
      userId,
      data: payload || {},
    });
    log.payload = {
      ...(log.payload || {}),
      publishStatus: 'published',
      publishBackend: publishResult?.backend || 'unknown',
      publishRoomCount: Number(publishResult?.roomCount || 0),
      publishDeliveredSockets: Number(publishResult?.deliveredSockets || 0),
    };
  } catch (error) {
    console.warn('Tracking event publish failed:', error.message);
    log.payload = {
      ...(log.payload || {}),
      publishStatus: 'failed',
      publishError: error.message,
    };
  }

  await log.save();

  return log;
}

module.exports = {
  recordTrackingEvent,
};
