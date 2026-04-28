const mongoose = require('mongoose');

const DeliveryTask = require('../models/DeliveryTask');
const DispatchBatch = require('../models/DispatchBatch');
const { assignSingleOrder, assignBatches } = require('../services/dispatchEngineService');
const { getEtaForOrder } = require('../services/etaService');
const { riderSlaScore, vendorSlaScore } = require('../services/slaScoringService');
const { isAllowedAdminEmail } = require('./authController');

function ensureDispatchAdmin(req, res) {
  if (!req.user?.uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  const privileged = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!privileged || !emailAllowed) {
    res.status(403).json({ success: false, message: 'Dispatch access denied.' });
    return false;
  }
  return true;
}

function serializeBatch(batch) {
  const source = typeof batch.toObject === 'function' ? batch.toObject() : batch;
  return {
    id: source._id?.toString() || '',
    batchId: source.batchId || '',
    riderId: source.riderId || '',
    orderIds: source.orderIds || [],
    taskIds: source.taskIds || [],
    score: Number(source.score || 0),
    estimatedDistanceKm: Number(source.estimatedDistanceKm || 0),
    estimatedDurationMins: Number(source.estimatedDurationMins || 0),
    sameDayDeadlineAt: source.sameDayDeadlineAt || null,
    status: source.status || 'created',
    metadata: source.metadata || {},
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function dispatchAssign(req, res, next) {
  try {
    if (!ensureDispatchAdmin(req, res)) return;
    const orderId = String(req.body?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Valid orderId is required.' });
    }

    const data = await assignSingleOrder({
      orderId,
      actor: req.user,
    });
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function dispatchBatchAssign(req, res, next) {
  try {
    if (!ensureDispatchAdmin(req, res)) return;
    const city = String(req.body?.city || '').trim();
    const result = await assignBatches({
      city,
      actor: req.user,
    });
    return res.status(200).json({
      success: true,
      data: {
        batches: (result.batches || []).map(serializeBatch),
        skipped: Number(result.skipped || 0),
        consideredClusters: Number(result.consideredClusters || 0),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getOrderEta(req, res, next) {
  try {
    if (!ensureDispatchAdmin(req, res)) return;
    const orderId = String(req.params?.orderId || '').trim();
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ success: false, message: 'Invalid orderId.' });
    }
    const eta = await getEtaForOrder(orderId);
    return res.status(200).json({ success: true, data: eta });
  } catch (error) {
    return next(error);
  }
}

async function listDispatchBatches(req, res, next) {
  try {
    if (!ensureDispatchAdmin(req, res)) return;
    const filter = {};
    if (req.query?.riderId) {
      filter.riderId = String(req.query.riderId).trim();
    }
    if (req.query?.status) {
      filter.status = String(req.query.status).trim();
    }
    const batches = await DispatchBatch.find(filter).sort({ createdAt: -1 }).limit(200);
    return res.status(200).json({
      success: true,
      data: batches.map(serializeBatch),
    });
  } catch (error) {
    return next(error);
  }
}

async function triggerDispatchRebalance(req, res, next) {
  try {
    if (!ensureDispatchAdmin(req, res)) return;
    const stuckTasks = await DeliveryTask.find({
      status: { $in: ['assigned', 'accepted'] },
      updatedAt: { $lte: new Date(Date.now() - 30 * 60 * 1000) },
    })
      .limit(40)
      .lean();

    const rebalanced = [];
    for (const task of stuckTasks) {
      if (!task.orderId || !mongoose.Types.ObjectId.isValid(task.orderId)) continue;
      try {
        const assigned = await assignSingleOrder({
          orderId: task.orderId,
          actor: req.user,
          replacementTaskId: task._id.toString(),
          excludedRiderIds: [String(task.riderId || '').trim()].filter(Boolean),
        });
        rebalanced.push(assigned);
      } catch (_) {
        // Skip failures and continue.
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        scanned: stuckTasks.length,
        rebalancedCount: rebalanced.length,
        rebalanced,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getSlaOverview(req, res, next) {
  try {
    if (!ensureDispatchAdmin(req, res)) return;
    const riderId = String(req.query?.riderId || '').trim();
    const vendorId = String(req.query?.vendorId || '').trim();
    const storeId = String(req.query?.storeId || '').trim();
    const [riderSla, vendorSla] = await Promise.all([
      riderId ? riderSlaScore({ riderId }) : null,
      vendorId || storeId ? vendorSlaScore({ vendorId, storeId }) : null,
    ]);
    return res.status(200).json({
      success: true,
      data: {
        rider: riderSla,
        vendor: vendorSla,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  dispatchAssign,
  dispatchBatchAssign,
  getOrderEta,
  listDispatchBatches,
  triggerDispatchRebalance,
  getSlaOverview,
};
