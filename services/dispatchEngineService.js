const crypto = require('crypto');

const DeliveryTask = require('../models/DeliveryTask');
const DispatchBatch = require('../models/DispatchBatch');
const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');
const { createAssignedTask } = require('./assignmentEngineService');
const { riderSlaScore } = require('./slaScoringService');
const { runInTransaction, ensureEntityMappings } = require('./opsConsistencyService');

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

function scoreDispatch({
  distanceKm,
  delayPenalty,
  batchSize,
  slaWeight,
}) {
  // Lower is better.
  return distanceKm + delayPenalty - batchSize + slaWeight;
}

function batchId() {
  const token = crypto.randomBytes(5).toString('hex');
  return `batch_${Date.now()}_${token}`;
}

function orderDelayPenalty(order) {
  const createdAt = new Date(order.createdAt || Date.now()).getTime();
  const ageMins = Math.max(0, (Date.now() - createdAt) / 60000);
  return ageMins > 90 ? 18 : ageMins > 60 ? 12 : ageMins > 30 ? 6 : 2;
}

async function assignSingleOrder({ orderId, actor = {} }) {
  const order = await Order.findById(orderId);
  if (!order) {
    const error = new Error('Order not found.');
    error.statusCode = 404;
    throw error;
  }
  const store = await Store.findById(order.storeId);
  if (!store) {
    const error = new Error('Store not found for this order.');
    error.statusCode = 404;
    throw error;
  }

  if (
    actor.role === 'vendor' &&
    String(store.ownerId || '').trim() !== String(actor.uid || '').trim()
  ) {
    const error = new Error('Order does not belong to this vendor.');
    error.statusCode = 403;
    throw error;
  }

  const assignment = await runInTransaction(async (session) => {
    const assigned = await createAssignedTask({
      taskType: 'ORDER_DELIVERY',
      entityType: 'order',
      entityId: order._id.toString(),
      orderId: order._id.toString(),
      storeId: store._id.toString(),
      vendorId: store.ownerId || '',
      userId: order.userId || '',
      pickupAddress: [store.name, store.address, store.city].filter(Boolean).join(', '),
      dropAddress: [
        order.shippingAddress?.name,
        order.shippingAddress?.addressLine1,
        order.shippingAddress?.city,
      ].filter(Boolean).join(', '),
      pickupLat: store.latitude,
      pickupLng: store.longitude,
      dropLat: null,
      dropLng: null,
      city: store.city || '',
      sameDay: true,
      session,
      metadata: { source: 'dispatch_assign' },
    });

    order.riderId = assigned.rider.uid;
    order.assignedDeliveryPartner = assigned.rider.name || 'Assigned Rider';
    order.deliveryStatus = 'Assigned';
    await order.save({ session });
    return assigned;
  });
  await ensureEntityMappings({ orderId: order._id.toString() });

  return {
    orderId: order._id.toString(),
    riderId: assignment.rider.uid,
    taskId: assignment.task._id.toString(),
    score: scoreDispatch({
      distanceKm: assignment.metrics.distanceKm,
      delayPenalty: orderDelayPenalty(order),
      batchSize: 1,
      slaWeight: 0,
    }),
  };
}

async function eligibleOrdersForBatch({ city = '', limit = 40 }) {
  const filter = {
    orderStatus: { $in: ['confirmed', 'processing'] },
    deliveryStatus: { $in: ['Ready for pickup', 'Assigned'] },
    riderId: '',
  };
  const orders = await Order.find(filter)
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  const stores = await Store.find({
    _id: { $in: [...new Set(orders.map((order) => order.storeId).filter(Boolean))] },
    ...(city ? { city: new RegExp(`^${city}$`, 'i') } : {}),
  })
    .select('_id city latitude longitude sameDay operationalSpeedScore ownerId name address')
    .lean();
  const storeMap = new Map(stores.map((store) => [store._id.toString(), store]));
  return orders
    .map((order) => ({
      order,
      store: storeMap.get(String(order.storeId || '')),
    }))
    .filter((row) => row.store && row.store.sameDay?.enabled === true);
}

function clusterOrders(rows = []) {
  const clusters = [];
  const consumed = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    if (consumed.has(i)) continue;
    const pivot = rows[i];
    const cluster = [pivot];
    consumed.add(i);
    for (let j = i + 1; j < rows.length; j += 1) {
      if (consumed.has(j)) continue;
      const candidate = rows[j];
      const distance = haversineDistanceKm(
        Number(pivot.store?.latitude || 0),
        Number(pivot.store?.longitude || 0),
        Number(candidate.store?.latitude || 0),
        Number(candidate.store?.longitude || 0),
      );
      if (distance <= 3 && cluster.length < 5) {
        cluster.push(candidate);
        consumed.add(j);
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

async function availableRidersByCity(city = '') {
  const riders = await User.find({
    role: 'rider',
    isActive: true,
    riderApprovalStatus: 'approved',
    riderAvailable: true,
    ...(city ? { riderCity: new RegExp(`^${city}$`, 'i') } : {}),
  })
    .select('uid name riderCapacity latitude longitude')
    .lean();

  const activeTasks = await DeliveryTask.aggregate([
    {
      $match: {
        riderId: { $in: riders.map((rider) => rider.uid) },
        status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] },
      },
    },
    {
      $group: {
        _id: '$riderId',
        tasks: { $sum: 1 },
      },
    },
  ]);
  const loadMap = new Map(activeTasks.map((row) => [String(row._id), Number(row.tasks || 0)]));
  return riders.map((rider) => ({
    ...rider,
    activeLoad: loadMap.get(rider.uid) || 0,
    capacity: Number(rider.riderCapacity || 4),
  }));
}

async function assignBatches({ city = '', actor = {} }) {
  const rows = await eligibleOrdersForBatch({ city });
  if (rows.length === 0) {
    return { batches: [], skipped: 0 };
  }

  const clusters = clusterOrders(rows);
  const riders = await availableRidersByCity(city);
  const assignedBatches = [];
  const skippedClusters = [];

  for (const cluster of clusters) {
    const clusterCity = cluster[0]?.store?.city || city;
    let bestRider = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const rider of riders) {
      const freeSlots = Math.max(0, rider.capacity - rider.activeLoad);
      if (freeSlots < cluster.length) continue;

      const distance = haversineDistanceKm(
        Number(rider.latitude || 0),
        Number(rider.longitude || 0),
        Number(cluster[0].store?.latitude || 0),
        Number(cluster[0].store?.longitude || 0),
      );
      const delayPenalty = cluster.reduce((sum, row) => sum + orderDelayPenalty(row.order), 0) / cluster.length;
      const sla = await riderSlaScore({ riderId: rider.uid });
      const slaWeight = (1 - Number(sla.score || 0) / 100) * 4;
      const score = scoreDispatch({
        distanceKm: distance,
        delayPenalty,
        batchSize: cluster.length,
        slaWeight,
      });

      if (score < bestScore) {
        bestScore = score;
        bestRider = rider;
      }
    }

    if (!bestRider) {
      skippedClusters.push(cluster);
      continue;
    }

    const taskIds = [];
    const orderIds = [];
    for (const row of cluster) {
      const order = await Order.findById(row.order._id);
      if (!order) continue;
      const task = await DeliveryTask.create({
        taskType: 'ORDER_DELIVERY',
        entityType: 'order',
        entityId: order._id.toString(),
        orderId: order._id.toString(),
        storeId: order.storeId?.toString() || '',
        vendorId: row.store.ownerId || '',
        userId: order.userId || '',
        riderId: bestRider.uid,
        status: 'assigned',
        sameDay: true,
        pickupAddress: [row.store.name, row.store.address, clusterCity].filter(Boolean).join(', '),
        dropAddress: [
          order.shippingAddress?.name,
          order.shippingAddress?.addressLine1,
          order.shippingAddress?.city,
        ].filter(Boolean).join(', '),
        pickupLat: row.store.latitude ?? null,
        pickupLng: row.store.longitude ?? null,
        metadata: {
          source: 'dispatch_batch_assign',
          batchSize: cluster.length,
        },
      });
      order.riderId = bestRider.uid;
      order.assignedDeliveryPartner = bestRider.name || 'Assigned Rider';
      order.deliveryStatus = 'Assigned';
      await order.save();
      await ensureEntityMappings({ orderId: order._id.toString() });

      bestRider.activeLoad += 1;
      taskIds.push(task._id.toString());
      orderIds.push(order._id.toString());
    }

    const batch = await DispatchBatch.create({
      batchId: batchId(),
      riderId: bestRider.uid,
      orderIds,
      taskIds,
      score: bestScore,
      estimatedDistanceKm: Number(cluster.length * 2.1),
      estimatedDurationMins: Math.max(12, cluster.length * 14),
      sameDayDeadlineAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
      status: 'assigned',
      metadata: {
        city: clusterCity,
        algorithm: 'greedy_cluster_v1',
        actorId: actor.uid || '',
      },
    });
    assignedBatches.push(batch);
  }

  return {
    batches: assignedBatches,
    skipped: skippedClusters.length,
    consideredClusters: clusters.length,
  };
}

module.exports = {
  assignSingleOrder,
  assignBatches,
};
