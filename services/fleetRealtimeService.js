const { getJson, setJson } = require('./redisCacheService');

function zoneKey(zoneId) {
  return `zone:${zoneId}`;
}

function riderLiveKey(riderId) {
  return `rider:live:${riderId}`;
}

async function updateRiderLiveState(riderId, payload) {
  const key = riderLiveKey(riderId);
  await setJson(key, {
    rider_id: riderId,
    lat: Number(payload.lat || 0),
    lng: Number(payload.lng || 0),
    speed: Number(payload.speed || 0),
    heading: Number(payload.heading || 0),
    battery: Number(payload.battery || 0),
    network_quality: payload.network_quality || 'unknown',
    order_id: payload.order_id || '',
    timestamp: payload.timestamp || new Date().toISOString(),
  }, 25);
}

async function getRiderLiveState(riderId) {
  return getJson(riderLiveKey(riderId));
}

async function updateZoneSnapshot(zoneId, snapshot) {
  await setJson(zoneKey(zoneId), snapshot, 60);
}

async function getZoneSnapshot(zoneId) {
  return getJson(zoneKey(zoneId));
}

module.exports = {
  updateRiderLiveState,
  getRiderLiveState,
  updateZoneSnapshot,
  getZoneSnapshot,
};
