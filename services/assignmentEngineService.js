const DeliveryTask = require('../models/DeliveryTask');
const User = require('../models/User');

const ACTIVE_STATUSES = new Set(['assigned', 'accepted', 'picked_up', 'out_for_delivery']);

function toNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
  const valid = [lat1, lng1, lat2, lng2].every((value) => Number.isFinite(value));
  if (!valid) {
    return 999;
  }
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

function randomOtp() {
  return `${Math.floor(1000 + Math.random() * 9000)}`;
}

async function activeWorkloadByRider(riderIds = []) {
  if (riderIds.length === 0) {
    return new Map();
  }

  const stats = await DeliveryTask.aggregate([
    {
      $match: {
        riderId: { $in: riderIds },
        status: { $in: [...ACTIVE_STATUSES] },
      },
    },
    {
      $group: {
        _id: '$riderId',
        count: { $sum: 1 },
      },
    },
  ]);

  return new Map(stats.map((row) => [String(row._id), Number(row.count || 0)]));
}

function riderScore({ distanceKm, workload }) {
  // Lower score is better.
  return distanceKm * 1.25 + workload * 2.75;
}

function riderEligibilityFilter(city = '') {
  const normalizedCity = String(city || '').trim().toLowerCase();
  return {
    $or: [
      { role: 'rider' },
      { 'roles.rider': true },
    ],
    isActive: true,
    riderApprovalStatus: 'approved',
    riderAvailable: true,
    ...(normalizedCity ? { riderCity: new RegExp(`^${normalizedCity}$`, 'i') } : {}),
  };
}

async function findBestRider({
  pickupLat,
  pickupLng,
  city = '',
  preferredRiderId = '',
  excludedRiderIds = [],
  session = null,
}) {
  const normalizedCity = String(city || '').trim().toLowerCase();

  const riders = await User.find(riderEligibilityFilter(normalizedCity))
    .select('uid name latitude longitude riderCity riderCapacity')
    .session(session)
    .lean();

  if (riders.length === 0) {
    return null;
  }

  const excluded = new Set((excludedRiderIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  const filteredRiders = riders.filter((rider) => !excluded.has(String(rider.uid || '').trim()));
  const preferred = String(preferredRiderId || '').trim();
  if (preferred) {
    const preferredRider = filteredRiders.find((rider) => String(rider.uid || '').trim() === preferred);
    if (!preferredRider) {
      const error = new Error('Preferred rider is unavailable for assignment.');
      error.statusCode = 409;
      throw error;
    }
    const riderLat = toNumber(preferredRider.latitude);
    const riderLng = toNumber(preferredRider.longitude);
    const distanceKm = haversineDistanceKm(pickupLat, pickupLng, riderLat, riderLng);
    const workloadMap = await activeWorkloadByRider([preferredRider.uid]);
    const workload = workloadMap.get(preferredRider.uid) || 0;
    return {
      rider: preferredRider,
      workload,
      distanceKm,
      score: riderScore({ distanceKm, workload }),
    };
  }
  const riderIds = filteredRiders.map((rider) => rider.uid).filter(Boolean);
  const workloadMap = await activeWorkloadByRider(riderIds);

  const ranked = filteredRiders.map((rider) => {
    const riderLat = toNumber(rider.latitude);
    const riderLng = toNumber(rider.longitude);
    const distanceKm = haversineDistanceKm(pickupLat, pickupLng, riderLat, riderLng);
    const workload = workloadMap.get(rider.uid) || 0;
    return {
      rider,
      workload,
      distanceKm,
      score: riderScore({ distanceKm, workload }),
    };
  }).sort((left, right) => left.score - right.score);

  return ranked[0] || null;
}

async function createAssignedTask({
  taskType,
  entityType,
  entityId,
  orderId = '',
  trialSessionId = '',
  storeId = '',
  vendorId = '',
  userId = '',
  pickupAddress = '',
  dropAddress = '',
  pickupLat = null,
  pickupLng = null,
  dropLat = null,
  dropLng = null,
  city = '',
  sameDay = false,
  preferredRiderId = '',
  excludedRiderIds = [],
  session = null,
  metadata = {},
}) {
  const existingActiveTask = await DeliveryTask.findOne({
    entityType: String(entityType || ''),
    entityId: String(entityId || ''),
    taskType: String(taskType || ''),
    status: { $in: [...ACTIVE_STATUSES] },
  }).session(session);
  if (existingActiveTask) {
    const error = new Error('An active task already exists for this entity.');
    error.statusCode = 409;
    throw error;
  }

  const best = await findBestRider({
    pickupLat,
    pickupLng,
    city,
    preferredRiderId,
    excludedRiderIds,
    session,
  });
  if (!best?.rider?.uid) {
    const error = new Error('No available rider found for assignment.');
    error.statusCode = 409;
    throw error;
  }

  const [task] = await DeliveryTask.create([{
    taskType,
    entityType,
    entityId: String(entityId),
    orderId: String(orderId || ''),
    trialSessionId: String(trialSessionId || ''),
    storeId: String(storeId || ''),
    vendorId: String(vendorId || ''),
    userId: String(userId || ''),
    riderId: best.rider.uid,
    status: 'assigned',
    sameDay: sameDay === true,
    pickupAddress: String(pickupAddress || '').trim(),
    dropAddress: String(dropAddress || '').trim(),
    pickupLat: toNumber(pickupLat),
    pickupLng: toNumber(pickupLng),
    dropLat: toNumber(dropLat),
    dropLng: toNumber(dropLng),
    routeDistanceKm: Number(best.distanceKm || 0),
    routeDurationMins: Math.max(5, Math.round((Number(best.distanceKm || 0) / 24) * 60)),
    workloadAtAssignment: Number(best.workload || 0),
    otpCode: randomOtp(),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  }], { session });

  return {
    task,
    rider: {
      uid: best.rider.uid,
      name: best.rider.name || 'Assigned Rider',
      riderCity: best.rider.riderCity || '',
    },
    metrics: {
      distanceKm: Number(best.distanceKm || 0),
      workload: Number(best.workload || 0),
      score: Number(best.score || 0),
    },
  };
}

module.exports = {
  ACTIVE_STATUSES,
  createAssignedTask,
  riderEligibilityFilter,
};
