const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');
const OpsZone = require('../models/OpsZone');
const { setJson, getJson } = require('./redisCacheService');
const { publishTrackingEvent } = require('./trackingGateway');

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function zoneIdFromLocation(city, lat, lng) {
  const cell = 0.02;
  const latCell = Math.floor(toNumber(lat) / cell);
  const lngCell = Math.floor(toNumber(lng) / cell);
  const cityKey = String(city || 'na').trim().toLowerCase().replace(/\s+/g, '-');
  return `${cityKey}:${latCell}:${lngCell}`;
}

function zoneCenterFromId(zoneId) {
  const parts = String(zoneId || '').split(':');
  const latCell = Number(parts[1] || 0);
  const lngCell = Number(parts[2] || 0);
  const cell = 0.02;
  return {
    lat: (latCell + 0.5) * cell,
    lng: (lngCell + 0.5) * cell,
  };
}

async function rebuildZones() {
  const activeOrders = await Order.find({
    orderStatus: { $in: ['confirmed', 'processing', 'shipped'] },
    deliveryStatus: { $in: ['Pending', 'Ready for pickup', 'Assigned', 'Picked up', 'Out for delivery'] },
  })
    .select('_id storeId')
    .lean();

  const storeIds = [...new Set(activeOrders.map((o) => String(o.storeId || '')).filter(Boolean))];
  const stores = await Store.find({ _id: { $in: storeIds } }).select('_id city latitude longitude').lean();
  const storeMap = new Map(stores.map((s) => [String(s._id), s]));

  const riders = await User.find({
    $or: [{ role: 'rider' }, { 'roles.rider': true }],
    isActive: true,
    riderApprovalStatus: 'approved',
    riderAvailable: true,
  })
    .select('uid riderCity latitude longitude')
    .lean();

  const zoneAccumulator = new Map();
  for (const order of activeOrders) {
    const store = storeMap.get(String(order.storeId || ''));
    if (!store) continue;
    const zoneId = zoneIdFromLocation(store.city, store.latitude, store.longitude);
    const zone = zoneAccumulator.get(zoneId) || {
      zoneId,
      city: String(store.city || '').trim(),
      activeOrders: 0,
      activeRiders: 0,
    };
    zone.activeOrders += 1;
    zoneAccumulator.set(zoneId, zone);
  }

  for (const rider of riders) {
    const zoneId = zoneIdFromLocation(rider.riderCity || '', rider.latitude, rider.longitude);
    const zone = zoneAccumulator.get(zoneId) || {
      zoneId,
      city: String(rider.riderCity || '').trim(),
      activeOrders: 0,
      activeRiders: 0,
    };
    zone.activeRiders += 1;
    zoneAccumulator.set(zoneId, zone);
  }

  const updates = [];
  for (const zone of zoneAccumulator.values()) {
    const center = zoneCenterFromId(zone.zoneId);
    const demandScore = zone.activeOrders / Math.max(1, zone.activeRiders);
    const existing = await OpsZone.findOne({ zoneId: zone.zoneId });
    const frozen = Boolean(existing?.frozen);
    const freezeReason = existing?.freezeReason || '';
    const payload = {
      zoneId: zone.zoneId,
      city: zone.city,
      center,
      radiusKm: Number(existing?.radiusKm || 2.5),
      activeOrders: zone.activeOrders,
      activeRiders: zone.activeRiders,
      demandScore: Number(demandScore.toFixed(3)),
      frozen,
      freezeReason,
      updatedAtIso: new Date().toISOString(),
    };
    await OpsZone.updateOne({ zoneId: zone.zoneId }, { $set: payload }, { upsert: true });
    await setJson(`zone:${zone.zoneId}`, payload, 30);
    await publishTrackingEvent({
      eventType: 'zone_update',
      data: payload,
      extraRooms: [`zone:${zone.zoneId}`],
      namespace: 'ops',
    });
    updates.push(payload);
  }

  return updates;
}

async function getZones({ city = '' } = {}) {
  const filter = city ? { city: new RegExp(`^${String(city).trim()}$`, 'i') } : {};
  return OpsZone.find(filter).sort({ demandScore: -1 }).lean();
}

async function setZoneFrozen(zoneId, frozen, reason = '') {
  const zone = await OpsZone.findOne({ zoneId });
  if (!zone) {
    return null;
  }
  zone.frozen = Boolean(frozen);
  zone.freezeReason = frozen ? String(reason || '').trim() : '';
  zone.updatedAtIso = new Date().toISOString();
  await zone.save();
  const payload = zone.toObject();
  await setJson(`zone:${zoneId}`, payload, 60);
  return payload;
}

async function getZoneState(zoneId) {
  const cached = await getJson(`zone:${zoneId}`);
  if (cached) return cached;
  const zone = await OpsZone.findOne({ zoneId }).lean();
  return zone || null;
}

module.exports = {
  zoneIdFromLocation,
  rebuildZones,
  getZones,
  setZoneFrozen,
  getZoneState,
};
