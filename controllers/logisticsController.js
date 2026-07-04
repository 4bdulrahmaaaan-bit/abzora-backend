const mongoose = require('mongoose');

const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Store = require('../models/Store');
const TrialHomeSession = require('../models/TrialHomeSession');
const { createAssignedTask } = require('../services/assignmentEngineService');
const { recordTrackingEvent } = require('../services/trackingEventService');
const { ensureEntityMappings } = require('../services/opsConsistencyService');
const {
  requestTrialHomeSession,
  serializeTrialHomeSession,
} = require('../services/trialHomeService');
const { hasRole } = require('../middleware/authorizationMiddleware');
const { deliveryCheck, getOrderTracking } = require('../services/hyperlocalDeliveryService');
const { getJson } = require('../services/redisCacheService');

function ensureAuth(req, res) {
  if (!req.user?.uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

function ensureRole(req, res, allowedRoles = []) {
  if (!ensureAuth(req, res)) {
    return false;
  }
  if (!hasRole(req.user, allowedRoles)) {
    res.status(403).json({ success: false, message: 'Access denied.' });
    return false;
  }
  return true;
}

function isVendorUser(user) {
  return hasRole(user, ['vendor']);
}

function isRiderUser(user) {
  return hasRole(user, ['rider']);
}

function serializeTask(task) {
  if (!task) {
    return null;
  }
  const source = typeof task.toObject === 'function' ? task.toObject() : task;
  const rawType = String(source.taskType || '').toUpperCase();
  const description = source.metadata?.summary
    || source.metadata?.description
    || (rawType === 'TRIAL_PICKUP'
      ? 'Return pickup task'
      : rawType === 'TRIAL_DELIVERY'
        ? 'Trial delivery task'
        : 'Delivery task');
  return {
    id: source._id?.toString() || source.id || '',
    taskType: source.taskType || '',
    entityType: source.entityType || '',
    entityId: source.entityId || '',
    orderId: source.orderId || '',
    trialSessionId: source.trialSessionId || '',
    storeId: source.storeId || '',
    vendorId: source.vendorId || '',
    userId: source.userId || '',
    riderId: source.riderId || '',
    description,
    status: source.status || 'assigned',
    sameDay: source.sameDay === true,
    scheduledAt: source.scheduledAt || null,
    pickupAddress: source.pickupAddress || '',
    dropAddress: source.dropAddress || '',
    pickupLat: source.pickupLat ?? null,
    pickupLng: source.pickupLng ?? null,
    dropLat: source.dropLat ?? null,
    dropLng: source.dropLng ?? null,
    routeDistanceKm: Number(source.routeDistanceKm || 0),
    routeDurationMins: Number(source.routeDurationMins || 0),
    otpCode: source.otpCode || '',
    proofPhotoUrl: source.proofPhotoUrl || '',
    proofNote: source.proofNote || '',
    workloadAtAssignment: Number(source.workloadAtAssignment || 0),
    metadata: source.metadata || {},
    completedAt: source.completedAt || null,
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

function taskStatusMap(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const map = {
    assigned: 'assigned',
    accepted: 'accepted',
    picked_up: 'picked_up',
    out_for_delivery: 'out_for_delivery',
    delivered: 'delivered',
    cancelled: 'cancelled',
  };
  return map[normalized] || '';
}

function toOrderStatusFromTask(taskStatus) {
  if (taskStatus === 'accepted') {
    return { deliveryStatus: 'Assigned', orderStatus: 'confirmed' };
  }
  if (taskStatus === 'picked_up') {
    return { deliveryStatus: 'Picked up', orderStatus: 'processing' };
  }
  if (taskStatus === 'out_for_delivery') {
    return { deliveryStatus: 'Out for delivery', orderStatus: 'shipped' };
  }
  if (taskStatus === 'delivered') {
    return { deliveryStatus: 'Delivered', orderStatus: 'delivered' };
  }
  if (taskStatus === 'cancelled') {
    return { deliveryStatus: 'Cancelled', orderStatus: 'cancelled' };
  }
  return {};
}

async function assignRider(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }

    const taskType = String(req.body?.taskType || '').trim().toUpperCase();
    const orderId = String(req.body?.orderId || '').trim();
    const trialSessionId = String(req.body?.trialSessionId || '').trim();
    const preferredRiderId = String(req.body?.riderId || '').trim();
    const supported = ['ORDER_DELIVERY', 'TRIAL_DELIVERY', 'TRIAL_PICKUP'];

    if (!supported.includes(taskType)) {
      return res.status(400).json({ success: false, message: 'Unsupported taskType.' });
    }
    if (!orderId && !trialSessionId) {
      return res.status(400).json({ success: false, message: 'orderId or trialSessionId is required.' });
    }

    let assignment;
    if (taskType === 'ORDER_DELIVERY') {
      if (!mongoose.Types.ObjectId.isValid(orderId)) {
        return res.status(400).json({ success: false, message: 'Invalid orderId.' });
      }
      const order = await Order.findById(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found.' });
      }

      const store = await Store.findById(order.storeId);
      if (!store) {
        return res.status(404).json({ success: false, message: 'Store not found.' });
      }
      if (
        isVendorUser(req.user) &&
        String(store.ownerId || '').trim() !== String(req.user.uid || '').trim()
      ) {
        return res.status(403).json({ success: false, message: 'Order does not belong to your store.' });
      }

      assignment = await createAssignedTask({
        taskType,
        entityType: 'order',
        entityId: order._id.toString(),
        orderId: order._id.toString(),
        storeId: order.storeId?.toString() || '',
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
        dropLat: req.body?.dropLat,
        dropLng: req.body?.dropLng,
        city: store.city || req.body?.city || '',
        sameDay: req.body?.sameDay === true || order.sameDayOrder === true,
        preferredRiderId,
        metadata: {
          source: 'manual_assign',
          orderTotal: Number(order.totalAmount || 0),
        },
      });

      order.riderId = assignment.rider.uid;
      order.assignedDeliveryPartner = assignment.rider.name || 'Assigned Rider';
      order.deliveryStatus = 'Assigned';
      await order.save();
      await ensureEntityMappings({ orderId: order._id.toString() });
    } else {
      if (!mongoose.Types.ObjectId.isValid(trialSessionId)) {
        return res.status(400).json({ success: false, message: 'Invalid trialSessionId.' });
      }
      const trial = await TrialHomeSession.findById(trialSessionId);
      if (!trial) {
        return res.status(404).json({ success: false, message: 'Trial session not found.' });
      }

      const itemIds = (trial.items || [])
        .map((item) => String(item.productId || '').trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
      const firstItemProduct = itemIds.length > 0
        ? await Product.findById(itemIds[0]).select('storeId').lean()
        : null;
      const store = firstItemProduct?.storeId
        ? await Store.findById(firstItemProduct.storeId)
        : null;

      if (
        isVendorUser(req.user) &&
        store &&
        String(store.ownerId || '').trim() !== String(req.user.uid || '').trim()
      ) {
        return res.status(403).json({ success: false, message: 'Trial request does not belong to your store.' });
      }

      assignment = await createAssignedTask({
        taskType,
        entityType: 'trial_session',
        entityId: trial._id.toString(),
        trialSessionId: trial._id.toString(),
        storeId: store?._id?.toString() || '',
        vendorId: store?.ownerId || '',
        userId: trial.userId || '',
        pickupAddress: [store?.name, store?.address, store?.city].filter(Boolean).join(', '),
        dropAddress: trial.addressLabel || '',
        pickupLat: store?.latitude,
        pickupLng: store?.longitude,
        dropLat: req.body?.dropLat,
        dropLng: req.body?.dropLng,
        city: store?.city || req.body?.city || '',
        sameDay: req.body?.sameDay !== false,
        preferredRiderId,
        metadata: {
          source: 'manual_assign',
          deliverySlot: trial.deliverySlot || '',
        },
      });

      trial.status = taskType === 'TRIAL_PICKUP' ? 'trial_in_progress' : 'out_for_trial_delivery';
      trial.events.push({
        type: taskType === 'TRIAL_PICKUP' ? 'trial_pickup_assigned' : 'trial_delivery_assigned',
        actorId: req.user.uid,
        note: `Rider ${assignment.rider.uid} assigned.`,
        createdAt: new Date(),
      });
      await trial.save();
    }

    return res.status(200).json({
      success: true,
      data: {
        task: serializeTask(assignment.task),
        rider: assignment.rider,
        assignmentMetrics: assignment.metrics,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listRiderTasks(req, res, next) {
  try {
    if (!ensureRole(req, res, ['rider', 'admin', 'super_admin'])) {
      return;
    }
    const status = String(req.query?.status || '').trim().toLowerCase();
    const filter = isRiderUser(req.user)
      ? { riderId: req.user.uid }
      : {};
    if (status) {
      filter.status = taskStatusMap(status);
    }
    const tasks = await DeliveryTask.find(filter).sort({ createdAt: -1 }).limit(200);
    return res.status(200).json({ success: true, data: tasks.map(serializeTask) });
  } catch (error) {
    return next(error);
  }
}

async function listRiderActiveTasks(req, res, next) {
  try {
    if (!ensureRole(req, res, ['rider', 'admin', 'super_admin'])) {
      return;
    }
    const filter = isRiderUser(req.user)
      ? { riderId: req.user.uid, status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] } }
      : { status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] } };
    const tasks = await DeliveryTask.find(filter).sort({ createdAt: -1 }).limit(50);
    return res.status(200).json({ success: true, data: tasks.map(serializeTask) });
  } catch (error) {
    return next(error);
  }
}

async function updateRiderTaskStatus(req, res, next) {
  try {
    if (!ensureRole(req, res, ['rider', 'admin', 'super_admin'])) {
      return;
    }
    const taskId = String(req.params?.taskId || '').trim();
    const nextStatus = taskStatusMap(req.body?.status);
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ success: false, message: 'Invalid taskId.' });
    }
    if (!nextStatus) {
      return res.status(400).json({ success: false, message: 'Unsupported task status.' });
    }

    const task = await DeliveryTask.findById(taskId);
    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found.' });
    }
    if (isRiderUser(req.user) && task.riderId !== req.user.uid) {
      return res.status(403).json({ success: false, message: 'Task belongs to another rider.' });
    }

    const otp = String(req.body?.otp || '').trim();
    if (nextStatus === 'delivered' && task.otpCode && otp && otp !== task.otpCode) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }
    if (nextStatus === 'delivered' && task.otpCode && !otp && !req.body?.proofPhotoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Provide OTP or proofPhotoUrl before marking delivered.',
      });
    }

    task.status = nextStatus;
    if (req.body?.proofPhotoUrl) {
      task.proofPhotoUrl = String(req.body.proofPhotoUrl).trim();
    }
    if (req.body?.proofNote) {
      task.proofNote = String(req.body.proofNote).trim();
    }
    if (nextStatus === 'delivered') {
      task.completedAt = new Date();
    }
    await task.save();
    await recordTrackingEvent({
      eventType: 'task_status_update',
      orderId: task.orderId || '',
      taskId: task._id.toString(),
      riderId: task.riderId || '',
      userId: task.userId || '',
      payload: {
        taskType: task.taskType,
        status: nextStatus,
      },
    });

    if (task.entityType === 'order' && task.orderId && mongoose.Types.ObjectId.isValid(task.orderId)) {
      const order = await Order.findById(task.orderId);
      if (order) {
        const mapped = toOrderStatusFromTask(nextStatus);
        if (mapped.deliveryStatus) {
          order.deliveryStatus = mapped.deliveryStatus;
        }
        if (mapped.orderStatus) {
          order.orderStatus = mapped.orderStatus;
        }
        if (nextStatus === 'delivered' && order.paymentMethod === 'COD') {
          order.paymentStatus = 'paid';
        }
        await order.save();
        await ensureEntityMappings({ orderId: order._id.toString() });
      }
    } else if (
      task.entityType === 'trial_session' &&
      task.trialSessionId &&
      mongoose.Types.ObjectId.isValid(task.trialSessionId)
    ) {
      const trial = await TrialHomeSession.findById(task.trialSessionId);
      if (trial) {
        if (task.taskType === 'TRIAL_DELIVERY' && nextStatus === 'delivered') {
          trial.status = 'trial_in_progress';
        }
        if (task.taskType === 'TRIAL_PICKUP' && nextStatus === 'delivered') {
          trial.status = 'completed';
        }
        trial.events.push({
          type: 'rider_task_status',
          actorId: req.user.uid,
          note: `${task.taskType} moved to ${nextStatus}.`,
          createdAt: new Date(),
        });
        await trial.save();
      }
    }

    return res.status(200).json({ success: true, data: serializeTask(task) });
  } catch (error) {
    return next(error);
  }
}

async function listVendorOperationsOrders(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }
    const status = String(req.query?.status || '').trim().toLowerCase();
    let storeIds = [];
    if (isVendorUser(req.user)) {
      const stores = await Store.find({ ownerId: req.user.uid }).select('_id').lean();
      storeIds = stores.map((store) => store._id.toString());
    } else if (req.query?.storeId && mongoose.Types.ObjectId.isValid(req.query.storeId)) {
      storeIds = [req.query.storeId.toString()];
    }
    const query = {
      ...(storeIds.length > 0 ? { storeId: { $in: storeIds } } : {}),
    };
    if (status) {
      query.orderStatus = status;
    }
    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(300).lean();
    return res.status(200).json({ success: true, data: orders });
  } catch (error) {
    return next(error);
  }
}

async function updateVendorOrderFlow(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }
    const orderId = String(req.params?.orderId || '').trim();
    const nextStep = String(req.body?.status || '').trim().toLowerCase();
    const map = {
      new: { orderStatus: 'created', deliveryStatus: 'Pending' },
      accepted: { orderStatus: 'confirmed', deliveryStatus: 'Ready for pickup' },
      processing: { orderStatus: 'processing', deliveryStatus: 'Ready for pickup' },
      ready: { orderStatus: 'processing', deliveryStatus: 'Ready for pickup' },
      picked_up: { orderStatus: 'shipped', deliveryStatus: 'Picked up' },
      delivered: { orderStatus: 'delivered', deliveryStatus: 'Delivered' },
      rejected: { orderStatus: 'cancelled', deliveryStatus: 'Cancelled' },
    };
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }
    if (!map[nextStep]) {
      return res.status(400).json({ success: false, message: 'Unsupported vendor status.' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const store = await Store.findById(order.storeId);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    if (isVendorUser(req.user) && String(store.ownerId || '') !== String(req.user.uid || '')) {
      return res.status(403).json({ success: false, message: 'Order does not belong to your store.' });
    }

    order.orderStatus = map[nextStep].orderStatus;
    order.deliveryStatus = map[nextStep].deliveryStatus;
    if (nextStep === 'ready' && !order.riderId) {
      const assignment = await createAssignedTask({
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
        city: store.city || '',
        sameDay: true,
        metadata: { source: 'vendor_ready_auto_assign' },
      });
      order.riderId = assignment.rider.uid;
      order.assignedDeliveryPartner = assignment.rider.name || 'Assigned Rider';
      order.deliveryStatus = 'Assigned';
    }
    if (nextStep === 'delivered' && order.paymentMethod === 'COD') {
      order.paymentStatus = 'paid';
    }
    await order.save();
    return res.status(200).json({ success: true, data: order.toObject() });
  } catch (error) {
    return next(error);
  }
}

async function listVendorTrialRequests(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }
    const status = String(req.query?.status || '').trim().toLowerCase();
    const approvalStatus = String(req.query?.approvalStatus || '').trim().toLowerCase();
    let query = {};
    if (status) {
      query.status = status;
    }
    if (approvalStatus) {
      query.approvalStatus = approvalStatus;
    }
    if (isVendorUser(req.user)) {
      const stores = await Store.find({ ownerId: req.user.uid }).select('_id').lean();
      const storeIds = stores.map((store) => store._id);
      const products = await Product.find({ storeId: { $in: storeIds } }).select('_id').lean();
      const productIds = products.map((product) => product._id.toString());
      query = {
        ...query,
        'items.productId': { $in: productIds },
      };
    }
    const sessions = await TrialHomeSession.find(query).sort({ createdAt: -1 }).limit(250);
    return res.status(200).json({
      success: true,
      data: sessions.map(serializeTrialHomeSession),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateVendorTrialFlow(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid sessionId.' });
    }
    const session = await TrialHomeSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial session not found.' });
    }
    if (isVendorUser(req.user)) {
      const stores = await Store.find({ ownerId: req.user.uid }).select('_id').lean();
      const storeIds = stores.map((store) => store._id);
      const itemProductIds = (session.items || [])
        .map((item) => String(item.productId || '').trim())
        .filter((id) => mongoose.Types.ObjectId.isValid(id));
      const matchedProducts = await Product.find({
        _id: { $in: itemProductIds },
        storeId: { $in: storeIds },
      }).select('_id').lean();
      if (matchedProducts.length === 0) {
        return res.status(403).json({ success: false, message: 'Trial session does not belong to your store.' });
      }
    }

    const nextStatus = String(req.body?.status || '').trim().toLowerCase();
    const allowed = new Set([
      'request',
      'accepted',
      'packed',
      'out_for_trial',
      'completed',
      'converted',
      'returned',
      'converted_to_order',
      'converted_to_tailoring',
    ]);
    if (!allowed.has(nextStatus)) {
      return res.status(400).json({ success: false, message: 'Unsupported trial flow status.' });
    }

    if (nextStatus === 'accepted') {
      session.status = 'confirmed';
      session.approvalStatus = 'approved';
    } else if (nextStatus === 'packed') {
      session.status = 'confirmed';
    } else if (nextStatus === 'out_for_trial') {
      session.status = 'out_for_trial_delivery';
    } else if (nextStatus === 'completed') {
      session.status = 'completed';
    } else if (nextStatus === 'converted' || nextStatus === 'converted_to_order') {
      session.status = 'converted_to_order';
      session.converted = true;
    } else if (nextStatus === 'converted_to_tailoring') {
      session.status = 'converted_to_tailoring';
      session.converted = true;
    } else if (nextStatus === 'returned') {
      session.status = 'completed';
      session.returnObserved = true;
    }

    if (Array.isArray(req.body?.keptItems)) {
      session.keptItems = req.body.keptItems.map((item) => String(item).trim()).filter(Boolean);
    }
    if (Array.isArray(req.body?.returnedItems)) {
      session.returnedItems = req.body.returnedItems.map((item) => String(item).trim()).filter(Boolean);
    }
    session.events.push({
      type: 'vendor_trial_status_update',
      actorId: req.user.uid,
      note: String(req.body?.note || `Status moved to ${nextStatus}`).trim(),
      createdAt: new Date(),
    });
    await session.save();
    return res.status(200).json({ success: true, data: serializeTrialHomeSession(session) });
  } catch (error) {
    return next(error);
  }
}

async function createTrialAliasRequest(req, res, next) {
  try {
    if (!ensureAuth(req, res)) {
      return;
    }
    const session = await requestTrialHomeSession({
      userId: req.user.uid,
      actor: req.dbUser || req.user,
      payload: req.body || {},
    });
    return res.status(201).json({
      success: true,
      data: serializeTrialHomeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

async function trialAliasUpdateStatus(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'rider', 'admin', 'super_admin'])) {
      return;
    }
    const sessionId = String(req.body?.sessionId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, message: 'sessionId is required.' });
    }
    req.params.sessionId = sessionId;
    return updateVendorTrialFlow(req, res, next);
  } catch (error) {
    return next(error);
  }
}

async function getOperationsAnalytics(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }

    let storeFilter = {};
    let vendorStoreIds = [];
    let vendorProductIds = [];
    if (isVendorUser(req.user)) {
      const stores = await Store.find({ ownerId: req.user.uid }).select('_id').lean();
      vendorStoreIds = stores.map((store) => store._id.toString());
      vendorProductIds = (
        await Product.find({ storeId: { $in: vendorStoreIds } }).select('_id').lean()
      ).map((product) => product._id.toString());
      storeFilter = vendorStoreIds.length > 0 ? { storeId: { $in: vendorStoreIds } } : { storeId: { $in: [] } };
    }

    const [deliveryStats, vendorStats, trialStats] = await Promise.all([
      DeliveryTask.aggregate([
        ...(isVendorUser(req.user) ? [{ $match: storeFilter }] : []),
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            delivered: {
              $sum: { $cond: [{ $eq: ['$status', 'delivered'] }, 1, 0] },
            },
            sameDayDelivered: {
              $sum: {
                $cond: [{ $and: [{ $eq: ['$status', 'delivered'] }, { $eq: ['$sameDay', true] }] }, 1, 0],
              },
            },
            avgDistanceKm: { $avg: '$routeDistanceKm' },
          },
        },
      ]),
      Order.aggregate([
        ...(isVendorUser(req.user) ? [{ $match: storeFilter }] : []),
        {
          $group: {
            _id: '$storeId',
            totalOrders: { $sum: 1 },
            deliveredOrders: {
              $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] },
            },
          },
        },
        { $sort: { deliveredOrders: -1 } },
        { $limit: 20 },
      ]),
      TrialHomeSession.aggregate([
        ...(isVendorUser(req.user)
          ? [{ $match: { 'items.productId': { $in: vendorProductIds } } }]
          : []),
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            converted: {
              $sum: {
                $cond: [
                  { $in: ['$status', ['converted_to_order', 'converted_to_tailoring']] },
                  1,
                  0,
                ],
              },
            },
            completed: {
              $sum: {
                $cond: [{ $eq: ['$status', 'completed'] }, 1, 0],
              },
            },
          },
        },
      ]),
    ]);

    const delivery = deliveryStats[0] || {};
    const trial = trialStats[0] || {};
    return res.status(200).json({
      success: true,
      data: {
        deliveryTime: {
          avgDistanceKm: Number(delivery.avgDistanceKm || 0),
        },
        successRate: {
          delivery: Number(delivery.total || 0) > 0
            ? Number(delivery.delivered || 0) / Number(delivery.total || 1)
            : 0,
          sameDay: Number(delivery.total || 0) > 0
            ? Number(delivery.sameDayDelivered || 0) / Number(delivery.total || 1)
            : 0,
        },
        trialConversion: Number(trial.total || 0) > 0
          ? Number(trial.converted || 0) / Number(trial.total || 1)
          : 0,
        riderEfficiency: {
          deliveredTasks: Number(delivery.delivered || 0),
          totalTasks: Number(delivery.total || 0),
        },
        vendorPerformance: vendorStats,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function checkDeliveryAvailability(req, res, next) {
  try {
    const productId = String(req.query?.product_id || '').trim();
    const lat = Number(req.query?.lat);
    const lng = Number(req.query?.lng);
    const pincode = String(req.query?.pincode || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, message: 'product_id is required.' });
    }
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lng);
    const hasPincode = pincode.length > 0;
    if (!hasGeo && !hasPincode) {
      return res.status(400).json({
        success: false,
        message: 'lat and lng or pincode are required.',
      });
    }
    const result = await deliveryCheck({ productId, lat, lng, pincode });
    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function assignRiderForOrder(req, res, next) {
  try {
    if (!ensureRole(req, res, ['vendor', 'admin', 'super_admin'])) {
      return;
    }
    req.body = {
      ...(req.body || {}),
      taskType: 'ORDER_DELIVERY',
      orderId: String(req.body?.orderId || '').trim(),
    };
    return assignRider(req, res, next);
  } catch (error) {
    return next(error);
  }
}

async function trackOrder(req, res, next) {
  try {
    if (!ensureRole(req, res, ['user', 'customer', 'rider', 'vendor', 'admin', 'super_admin'])) {
      return;
    }
    const orderId = String(req.params?.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid order id.' });
    }
    const order = await Order.findById(orderId).select('userId riderId deliveryStatus orderStatus');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }
    const isOwner = String(order.userId || '') === String(req.user.uid || '');
    const isRider = String(order.riderId || '') === String(req.user.uid || '');
    const isAdmin = hasRole(req.user, ['admin', 'super_admin']);
    let isVendorOwner = false;
    if (isVendorUser(req.user)) {
      const vendorStore = await Store.findById(order.storeId).select('ownerId').lean();
      isVendorOwner = String(vendorStore?.ownerId || '') === String(req.user.uid || '');
    }
    if (!isOwner && !isRider && !isAdmin && !isVendorOwner) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    const riderLiveRaw = order.riderId ? await getJson(`rider:live:${order.riderId}`) : null;
    const riderLive = riderLiveRaw
      ? {
          lat: Number(riderLiveRaw.location?.lat || 0),
          lng: Number(riderLiveRaw.location?.lng || 0),
          status: riderLiveRaw.status || 'active',
        }
      : null;
    const tracking = await getOrderTracking(orderId, riderLive);
    return res.status(200).json({ success: true, data: tracking });
  } catch (error) {
    return next(error);
  }
}

function haversineDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return 0;
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function getOptimizedRiderRoute(req, res, next) {
  try {
    if (!ensureRole(req, res, ['rider', 'admin', 'super_admin'])) {
      return;
    }
    const riderId = isRiderUser(req.user) ? req.user.uid : req.query.riderId;
    if (!riderId) {
      return res.status(400).json({ success: false, message: 'Rider ID required.' });
    }
    
    const tasks = await DeliveryTask.find({ 
      riderId, 
      status: { $in: ['assigned', 'accepted', 'picked_up', 'out_for_delivery'] } 
    }).lean();

    const riderLat = Number(req.query.lat);
    const riderLng = Number(req.query.lng);

    let stops = [];
    for (const task of tasks) {
      const isReturn = task.taskType === 'TRIAL_PICKUP';
      let targetLat = isReturn ? task.pickupLat : task.dropLat;
      let targetLng = isReturn ? task.pickupLng : task.dropLng;
      
      if (task.status === 'assigned' || task.status === 'accepted') {
         targetLat = task.pickupLat;
         targetLng = task.pickupLng;
      }

      const distanceKm = (Number.isFinite(riderLat) && Number.isFinite(riderLng) && targetLat && targetLng) 
        ? haversineDistanceKm(riderLat, riderLng, targetLat, targetLng) 
        : null;

      stops.push({
        task: serializeTask(task),
        distanceKm,
        etaMins: distanceKm !== null ? Math.round(distanceKm * 3) + 5 : null,
        isReturn
      });
    }

    stops.sort((a, b) => {
      if (a.isReturn !== b.isReturn) {
        return a.isReturn ? 1 : -1;
      }
      if (a.distanceKm !== null && b.distanceKm !== null) {
        return a.distanceKm - b.distanceKm;
      }
      return 0;
    });

    return res.status(200).json({ success: true, data: stops });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  assignRider,
  listRiderTasks,
  listRiderActiveTasks,
  updateRiderTaskStatus,
  listVendorOperationsOrders,
  updateVendorOrderFlow,
  listVendorTrialRequests,
  updateVendorTrialFlow,
  createTrialAliasRequest,
  trialAliasUpdateStatus,
  getOperationsAnalytics,
  checkDeliveryAvailability,
  assignRiderForOrder,
  trackOrder,
  getOptimizedRiderRoute,
};
