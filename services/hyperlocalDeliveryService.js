const Product = require('../models/Product');
const Store = require('../models/Store');
const Order = require('../models/Order');
const { getJson, setJson } = require('./redisCacheService');

function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const valid = [lat1, lng1, lat2, lng2].every((v) => Number.isFinite(Number(v)));
  if (!valid) return Number.POSITIVE_INFINITY;
  const toRad = (value) => (value * Math.PI) / 180;
  const radiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return radiusKm * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function etaLabelForDistance(distanceKm) {
  if (distanceKm < 3) return '2-3 hrs';
  if (distanceKm < 8) return 'Today';
  if (distanceKm <= 15) return 'Within 24 hrs';
  return 'Not deliverable';
}

function estimatedEtaMinutes(distanceKm, prepTimeMinutes = 15) {
  const speedKmph = distanceKm < 3 ? 14 : distanceKm < 8 ? 18 : 22;
  const travelMinutes = Math.round((distanceKm / speedKmph) * 60);
  const bufferMinutes = distanceKm < 3 ? 20 : distanceKm < 8 ? 45 : 75;
  return Math.max(30, Number(prepTimeMinutes || 15) + travelMinutes + bufferMinutes);
}

async function deliveryCheck({ productId, lat, lng, pincode = '' }) {
  if (!productId) {
    return { available: false, reason: 'product_id_required' };
  }
  const cacheKey = `product:${productId}:nearby:${String(pincode || 'na').trim() || 'na'}`;
  const cached = await getJson(cacheKey);
  if (cached && Number.isFinite(lat) && Number.isFinite(lng)) {
    const nearest = (cached.vendors || [])
      .map((vendor) => ({
        ...vendor,
        distance_km: haversineDistanceKm(lat, lng, vendor.lat, vendor.lng),
      }))
      .sort((a, b) => a.distance_km - b.distance_km)[0];
    if (nearest && nearest.distance_km <= nearest.delivery_radius_km && nearest.distance_km <= 15) {
      const etaLabel = etaLabelForDistance(nearest.distance_km);
      return {
        available: true,
        eta: etaLabel,
        eta_minutes: estimatedEtaMinutes(nearest.distance_km, nearest.prep_time_minutes),
        vendor_id: nearest.vendor_id,
        distance_km: Number(nearest.distance_km.toFixed(2)),
      };
    }
  }

  const product = await Product.findById(productId).select('_id storeId stock sameDayEligible').lean();
  if (!product || Number(product.stock || 0) <= 0 || product.sameDayEligible !== true) {
    return { available: false, reason: 'product_unavailable' };
  }

  const stores = await Store.find({
    _id: product.storeId,
    isActive: true,
    approvalStatus: 'approved',
    'sameDay.enabled': true,
  }).lean();

  const candidates = stores
    .map((store) => {
      const storeLat = toNumber(store.latitude);
      const storeLng = toNumber(store.longitude);
      if (!Number.isFinite(storeLat) || !Number.isFinite(storeLng)) return null;
      const deliveryRadiusKm = Number(store.sameDay?.deliveryRadiusKm || 10);
      const prepTimeMinutes = Number(store.sameDay?.prepTimeMins || 15);
      const distance = haversineDistanceKm(lat, lng, storeLat, storeLng);
      return {
        vendor_id: String(store._id),
        lat: storeLat,
        lng: storeLng,
        ready_to_ship: Boolean(store.sameDay?.enabled && store.isActive),
        delivery_radius_km: deliveryRadiusKm,
        prep_time_minutes: prepTimeMinutes,
        distance_km: distance,
      };
    })
    .filter(Boolean)
    .filter((row) => row.ready_to_ship && row.distance_km <= row.delivery_radius_km && row.distance_km <= 15)
    .sort((a, b) => a.distance_km - b.distance_km);

  await setJson(
    cacheKey,
    {
      vendors: stores.map((store) => ({
        vendor_id: String(store._id),
        lat: Number(store.latitude || 0),
        lng: Number(store.longitude || 0),
        delivery_radius_km: Number(store.sameDay?.deliveryRadiusKm || 10),
        prep_time_minutes: Number(store.sameDay?.prepTimeMins || 15),
      })),
      created_at: new Date().toISOString(),
    },
    300,
  );

  const selected = candidates[0];
  if (!selected) {
    return { available: false, reason: 'no_vendor' };
  }

  return {
    available: true,
    eta: etaLabelForDistance(selected.distance_km),
    eta_minutes: estimatedEtaMinutes(selected.distance_km, selected.prep_time_minutes),
    vendor_id: selected.vendor_id,
    distance_km: Number(selected.distance_km.toFixed(2)),
  };
}

async function getOrderTracking(orderId, riderLive) {
  const order = await Order.findById(orderId).lean();
  if (!order) return null;
  return {
    order_id: String(order._id),
    status: String(order.deliveryStatus || order.orderStatus || 'Placed'),
    rider: riderLive || {
      lat: Number(order.riderLatitude || 0),
      lng: Number(order.riderLongitude || 0),
      status: order.deliveryStatus === 'Delivered' ? 'delivered' : 'active',
    },
    updated_at: order.riderLocationUpdatedAt || order.updatedAt,
  };
}

module.exports = {
  deliveryCheck,
  getOrderTracking,
};
