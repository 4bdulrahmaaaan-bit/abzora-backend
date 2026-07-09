const Product = require('../models/Product');
const Store = require('../models/Store');
const Order = require('../models/Order');
const OpsZone = require('../models/OpsZone');
const { getJson, setJson } = require('./redisCacheService');
const { enableLocalRiderDelivery } = require('./deliveryModeService');
const shiprocketService = require('./shiprocketService');

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

function isoDatePlusDays(days) {
  const next = new Date();
  next.setDate(next.getDate() + Math.max(0, Number(days) || 0));
  return next.toISOString().slice(0, 10);
}

function normalizeProviderList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function zoneMetadata(zone) {
  return zone?.metadata && typeof zone.metadata === 'object' ? zone.metadata : {};
}

function pickCourierProvider(zone, product) {
  const metadata = zoneMetadata(zone);
  const zoneProviders = normalizeProviderList(metadata.deliveryProviders);
  if (zoneProviders.length > 0) {
    return zoneProviders[0];
  }
  const productProviders = normalizeProviderList(product?.deliveryInfo?.providers);
  if (productProviders.length > 0) {
    return productProviders[0];
  }
  if (metadata.courierProvider) {
    return String(metadata.courierProvider).trim();
  }
  return 'Shiprocket';
}

function pickLocalProvider(zone) {
  const metadata = zoneMetadata(zone);
  if (metadata.localProvider) {
    return String(metadata.localProvider).trim();
  }
  return 'Local Rider';
}

function buildServiceabilityResponse({
  product,
  zone,
  store,
  distanceKm,
  hasGeoMatch,
  pincode,
  locality = '',
  city = '',
  state = '',
}) {
  const metadata = zoneMetadata(zone);
  const productDelivery = product?.deliveryInfo || {};
  const storeDelivery = store?.sameDay || {};
  const normalizedCity = String(city || '').trim().toLowerCase();
  const normalizedLocality = String(locality || '').trim().toLowerCase();
  const normalizedState = String(state || '').trim().toLowerCase();
  const zoneCity = String(zone?.city || '').trim().toLowerCase();
  const storeCity = String(store?.city || '').trim().toLowerCase();
  const hasCityMatch = Boolean(
    normalizedCity &&
      (normalizedCity === zoneCity || normalizedCity === storeCity),
  );
  const hasLocalityMatch = Boolean(
    normalizedLocality &&
      (normalizedLocality === zoneCity || normalizedLocality === storeCity),
  );
  const hasStateMatch = Boolean(
    normalizedState &&
      (normalizedState === zoneCity || normalizedState === storeCity),
  );
  const deliveryMatch = hasGeoMatch || hasCityMatch || hasLocalityMatch || hasStateMatch;
  const storeSupportsSameDay = storeDelivery.enabled !== false;
  const storeSupportsTrialHome = storeDelivery.supportsTrialHome !== false;
  const localRiderEnabled = enableLocalRiderDelivery();
  const tryAtHomeEnabled = Boolean(
    product?.trialHome?.trialEnabled ||
      product?.vendorMeta?.tryBeforeYouBuy ||
      productDelivery.tryAtHomeEligible ||
      productDelivery.tryAtHomeAvailable,
  );
  const instantEligible = Boolean(productDelivery.sameDayEligible ?? product?.sameDayEligible);
  const supportsTryAtHome = Boolean(
    localRiderEnabled &&
      deliveryMatch &&
      tryAtHomeEnabled &&
      storeSupportsTrialHome &&
      metadata.supportsTryAtHome !== false &&
      metadata.tryAtHomeEnabled !== false,
  );
  const supportsInstantDelivery = Boolean(
    localRiderEnabled &&
      deliveryMatch &&
      instantEligible &&
      storeSupportsSameDay &&
      metadata.supportsInstantDelivery !== false &&
      metadata.supportsLocalDelivery !== false,
  );
  const supportsCourierDelivery = Boolean(
    pincode || normalizedCity || normalizedLocality || normalizedState ||
      metadata.supportsCourierDelivery === true ||
      metadata.supportsCourierDelivery == null,
  ) && Number(product?.stock || 0) > 0;

  const shippingCharge = Number(
    metadata.shippingCharge ??
      (supportsTryAtHome ? metadata.tryAtHomeFee : null) ??
      (supportsInstantDelivery ? metadata.instantDeliveryCharge : null) ??
      (supportsCourierDelivery ? metadata.courierShippingCharge : null) ??
      40,
  );

  const instantEtaMinutes =
    Number(metadata.instantEtaMinutes) ||
    estimatedEtaMinutes(
      Number.isFinite(distanceKm) ? distanceKm : 0,
      Number(metadata.prepTimeMinutes || productDelivery.countdownMinutes || 15),
    );

  const instantEtaLabel =
    metadata.instantEtaLabel ||
    (Number.isFinite(distanceKm) ? etaLabelForDistance(distanceKm) : 'Today');

  const courierEtaDays = Number(metadata.courierEtaDays || 3);
  const courierProvider = pickCourierProvider(zone, product);
  const localProvider = pickLocalProvider(zone);
  const selectedDeliveryPartner = supportsTryAtHome || supportsInstantDelivery
    ? localProvider
    : supportsCourierDelivery
      ? courierProvider
      : '';
  const estimatedDeliveryDate = supportsCourierDelivery
    ? isoDatePlusDays(courierEtaDays)
    : supportsInstantDelivery || supportsTryAtHome
      ? isoDatePlusDays(0)
      : '';

  const isDeliverable = Boolean(
    supportsTryAtHome || supportsInstantDelivery || supportsCourierDelivery,
  );

  return {
    success: true,
    available: isDeliverable,
    isDeliverable,
    supportsTryAtHome,
    supportsInstantDelivery,
    supportsCourierDelivery,
    estimatedDeliveryDate,
    estimatedInstantDeliveryTime: supportsInstantDelivery || supportsTryAtHome
      ? `${Math.max(15, Math.round(instantEtaMinutes))} mins`
      : '',
    shippingCharge,
    deliveryPartner: selectedDeliveryPartner,
    deliveryProvider: selectedDeliveryPartner,
    courierProvider,
    localProvider,
    deliveryMode: supportsTryAtHome
      ? 'TRY_AT_HOME'
      : supportsInstantDelivery
        ? 'LOCAL_DELIVERY'
        : supportsCourierDelivery
          ? 'COURIER_DELIVERY'
          : 'UNAVAILABLE',
    serviceZoneId: zone?.zoneId || '',
    zoneId: zone?.zoneId || '',
    city: zone?.city || city || locality || state || '',
    pincode: pincode || '',
    eta: supportsInstantDelivery || supportsTryAtHome
      ? instantEtaLabel
      : supportsCourierDelivery
        ? `Delivery by ${estimatedDeliveryDate}`
        : 'Not deliverable',
    eta_minutes: supportsInstantDelivery || supportsTryAtHome
      ? Math.round(instantEtaMinutes)
      : 0,
    distance_km: Number.isFinite(distanceKm) ? Number(distanceKm.toFixed(2)) : null,
    reason: isDeliverable ? '' : 'location_unserviceable',
  };
}

async function deliveryCheck({ productId, lat, lng, pincode = '', locality = '', city = '', state = '' }) {
  if (!productId) {
    return { success: false, available: false, isDeliverable: false, reason: 'product_id_required' };
  }

  const cacheKey = `product:${productId}:serviceability:${Number.isFinite(lat) ? lat.toFixed(5) : 'na'}:${Number.isFinite(lng) ? lng.toFixed(5) : 'na'}:${String(pincode || 'na').trim() || 'na'}:${String(locality || 'na').trim().toLowerCase() || 'na'}:${String(city || 'na').trim().toLowerCase() || 'na'}:${String(state || 'na').trim().toLowerCase() || 'na'}`;
  const cached = await getJson(cacheKey);
  if (cached) {
    return cached;
  }

  const product = await Product.findById(productId)
    .select('_id storeId stock sameDayEligible trialHome deliveryInfo vendorMeta')
    .lean();
  if (!product || Number(product.stock || 0) <= 0) {
    return {
      success: true,
      available: false,
      isDeliverable: false,
      supportsTryAtHome: false,
      supportsInstantDelivery: false,
      supportsCourierDelivery: false,
      reason: 'product_unavailable',
    };
  }

  const zones = await OpsZone.find({ frozen: { $ne: true } }).lean();
  let bestZone = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const addressLat = Number(lat);
  const addressLng = Number(lng);
  const hasGeo = Number.isFinite(addressLat) && Number.isFinite(addressLng);
  const normalizedPincode = String(pincode || '').trim();
  const normalizedLocality = String(locality || '').trim().toLowerCase();
  const normalizedCity = String(city || '').trim().toLowerCase();
  const normalizedState = String(state || '').trim().toLowerCase();
  const productStore = await Store.findById(product.storeId)
    .select('city latitude longitude sameDay pincode')
    .lean();
  const productCity = String(productStore?.city || '').trim().toLowerCase();

  for (const zone of zones) {
    const zoneLat = toNumber(zone?.center?.lat);
    const zoneLng = toNumber(zone?.center?.lng);
    let distance = Number.POSITIVE_INFINITY;
    if (hasGeo && Number.isFinite(zoneLat) && Number.isFinite(zoneLng)) {
      distance = haversineDistanceKm(addressLat, addressLng, zoneLat, zoneLng);
    }
    const zoneCity = String(zone.city || '').trim().toLowerCase();
    const cityMatch =
      normalizedCity &&
      (normalizedCity === zoneCity || normalizedCity === productCity);
    const withinRadius = Number.isFinite(distance) && distance <= Number(zone.radiusKm || 0);
    const metadata = zoneMetadata(zone);
    const zonePincodes = normalizeProviderList(metadata.pincodes);
    const pinMatch = normalizedPincode && zonePincodes.includes(normalizedPincode);
    const zoneMatched = withinRadius || cityMatch || pinMatch;
    const matchScore = Number.isFinite(distance)
      ? distance
      : cityMatch || pinMatch
        ? 0
        : Number.POSITIVE_INFINITY;
    if (zoneMatched && matchScore < bestDistance) {
      bestDistance = matchScore;
      bestZone = zone;
    }
  }

  const response = buildServiceabilityResponse({
    product,
    zone: bestZone,
    store: productStore,
    distanceKm: bestDistance,
    hasGeoMatch: hasGeo || Boolean(bestZone),
    pincode: normalizedPincode,
    locality: normalizedLocality,
    city: normalizedCity || productStore?.city || '',
    state: normalizedState,
  });

  if (!response.isDeliverable && (normalizedPincode || normalizedCity || normalizedLocality || normalizedState)) {
    response.supportsCourierDelivery = true;
    response.isDeliverable = true;
    response.available = true;
    response.deliveryMode = 'COURIER_DELIVERY';
    response.deliveryPartner = response.courierProvider || response.deliveryPartner || 'Shiprocket';
    response.deliveryProvider = response.deliveryPartner;
    response.estimatedDeliveryDate = response.estimatedDeliveryDate || isoDatePlusDays(3);
    response.shippingCharge = response.shippingCharge || 40;
    response.reason = '';
  }

  
  // SHIPROCKET ETA FETCH
  if (response.supportsCourierDelivery && response.deliveryPartner === 'Shiprocket' && (!enableLocalRiderDelivery() || !response.supportsInstantDelivery)) {
    try {
      const srRates = await shiprocketService.getAvailableCouriers({
        pickupPostcode: productStore?.pincode || '110001',
        deliveryPostcode: normalizedPincode,
        weight: product.packageWeight || 0.5,
        cod: false
      });
      
      if (srRates && srRates.data && srRates.data.available_courier_companies) {
        const couriers = srRates.data.available_courier_companies;
        if (couriers.length > 0) {
          const cheapest = couriers.reduce((prev, curr) => (prev.rate < curr.rate) ? prev : curr);
          response.shippingCharge = cheapest.rate || response.shippingCharge;
          
          if (cheapest.etd) {
            response.estimatedDeliveryDate = cheapest.etd;
            response.eta = `Delivery by ${cheapest.etd.split(' ')[0]}`;
          }
        }
      }
    } catch (e) {
      console.error('Shiprocket ETA fetch error in deliveryCheck:', e);
    }
  }

  await setJson(cacheKey, response, 300);

  return response;
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
