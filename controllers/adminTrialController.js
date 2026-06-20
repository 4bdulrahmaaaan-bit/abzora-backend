const TrialHomeSession = require('../models/TrialHomeSession');
const AdminActivityLog = require('../models/AdminActivityLog');
const { isAllowedAdminEmail } = require('./authController');
const {
  getTrialDashboard,
  getTrialQueue,
  getTrialDetails,
  getTrialAnalytics,
} = require('../services/adminTrialAnalyticsService');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function toIsoNow() {
  return new Date().toISOString();
}

async function createAuditEntry(req, { action, targetType, targetId, message }) {
  const logId = `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AdminActivityLog.create({
    logId,
    actorId: req.user?.uid || 'admin',
    actorRole: req.user?.role || 'admin',
    action: String(action || '').trim(),
    targetType: String(targetType || '').trim(),
    targetId: String(targetId || '').trim(),
    message: String(message || '').trim(),
    timestampIso: toIsoNow(),
  });
}

// ─── GET /admin/trials/dashboard ────────────────────────────────
async function getTrialDashboardMetrics(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const data = await getTrialDashboard();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

// ─── GET /admin/trials/queue ────────────────────────────────────
async function getTrialQueueHandler(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const result = await getTrialQueue(req.query);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    return next(error);
  }
}

// ─── GET /admin/trials/:id ──────────────────────────────────────
async function getTrialDetailsHandler(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trial ID is required.' });
    }
    const data = await getTrialDetails(id);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error.message === 'Trial not found') {
      return res.status(404).json({ success: false, message: 'Trial not found.' });
    }
    return next(error);
  }
}

// ─── GET /admin/trials/analytics ────────────────────────────────
async function getTrialAnalyticsHandler(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const data = await getTrialAnalytics();
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

// ─── PATCH /admin/trials/:id/assign-rider ───────────────────────
async function assignRider(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    const riderId = String(req.body?.riderId || '').trim();
    if (!id || !riderId) {
      return res.status(400).json({ success: false, message: 'Trial ID and Rider ID are required.' });
    }

    const trial = await TrialHomeSession.findById(id);
    if (!trial) {
      return res.status(404).json({ success: false, message: 'Trial not found.' });
    }

    const previousStatus = trial.status;
    trial.riderId = riderId;
    trial.status = 'assigned';
    trial.events.push({
      type: 'rider_assigned',
      actorId: req.user?.uid || 'admin',
      note: `Rider ${riderId} assigned by admin.`,
      createdAt: new Date(),
    });
    await trial.save();

    await createAuditEntry(req, {
      action: 'TRIAL_ASSIGN_RIDER',
      targetType: 'trial',
      targetId: id,
      message: `Assigned rider ${riderId}. Status: ${previousStatus} → assigned.`,
    });

    return res.status(200).json({ success: true, data: { id, status: trial.status, riderId } });
  } catch (error) {
    return next(error);
  }
}

// ─── PATCH /admin/trials/:id/reschedule ─────────────────────────
async function reschedule(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    const scheduledAt = req.body?.scheduledAt;
    const deliverySlot = String(req.body?.deliverySlot || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trial ID is required.' });
    }

    const trial = await TrialHomeSession.findById(id);
    if (!trial) {
      return res.status(404).json({ success: false, message: 'Trial not found.' });
    }

    const previousStatus = trial.status;
    if (scheduledAt) trial.scheduledAt = new Date(scheduledAt);
    if (deliverySlot) trial.deliverySlot = deliverySlot;
    trial.status = 'booked';
    trial.events.push({
      type: 'rescheduled',
      actorId: req.user?.uid || 'admin',
      note: `Rescheduled by admin to ${scheduledAt || deliverySlot}.`,
      createdAt: new Date(),
    });
    await trial.save();

    await createAuditEntry(req, {
      action: 'TRIAL_RESCHEDULE',
      targetType: 'trial',
      targetId: id,
      message: `Rescheduled. Status: ${previousStatus} → booked.`,
    });

    return res.status(200).json({ success: true, data: { id, status: trial.status } });
  } catch (error) {
    return next(error);
  }
}

// ─── PATCH /admin/trials/:id/cancel ─────────────────────────────
async function cancelTrial(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trial ID is required.' });
    }

    const trial = await TrialHomeSession.findById(id);
    if (!trial) {
      return res.status(404).json({ success: false, message: 'Trial not found.' });
    }

    const previousStatus = trial.status;
    trial.status = 'cancelled';
    trial.trialOutcome = 'cancelled';
    trial.events.push({
      type: 'cancelled',
      actorId: req.user?.uid || 'admin',
      note: reason || 'Cancelled by admin.',
      createdAt: new Date(),
    });
    await trial.save();

    await createAuditEntry(req, {
      action: 'TRIAL_CANCEL',
      targetType: 'trial',
      targetId: id,
      message: `Cancelled. Reason: ${reason || 'None provided'}. Status: ${previousStatus} → cancelled.`,
    });

    return res.status(200).json({ success: true, data: { id, status: trial.status } });
  } catch (error) {
    return next(error);
  }
}

// ─── PATCH /admin/trials/:id/mark-purchased ─────────────────────
async function markPurchased(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    const keptItems = req.body?.keptItems || [];
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trial ID is required.' });
    }

    const trial = await TrialHomeSession.findById(id);
    if (!trial) {
      return res.status(404).json({ success: false, message: 'Trial not found.' });
    }

    const previousStatus = trial.status;
    trial.status = 'converted_to_order';
    trial.trialOutcome = 'converted';
    trial.converted = true;
    trial.completedAt = new Date();
    if (keptItems.length > 0) trial.keptItems = keptItems;
    trial.finalAmount = trial.items
      .filter(item => keptItems.includes(item.productId))
      .reduce((sum, item) => sum + (item.price || 0), 0);
    trial.events.push({
      type: 'marked_purchased',
      actorId: req.user?.uid || 'admin',
      note: `Marked as purchased by admin. Kept ${keptItems.length} items.`,
      createdAt: new Date(),
    });
    await trial.save();

    await createAuditEntry(req, {
      action: 'TRIAL_MARK_PURCHASED',
      targetType: 'trial',
      targetId: id,
      message: `Marked purchased. Items kept: ${keptItems.length}. Status: ${previousStatus} → converted_to_order.`,
    });

    return res.status(200).json({ success: true, data: { id, status: trial.status, finalAmount: trial.finalAmount } });
  } catch (error) {
    return next(error);
  }
}

// ─── PATCH /admin/trials/:id/mark-returned ──────────────────────
async function markReturned(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const id = String(req.params.id || '').trim();
    const returnedItems = req.body?.returnedItems || [];
    const reason = String(req.body?.reason || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: 'Trial ID is required.' });
    }

    const trial = await TrialHomeSession.findById(id);
    if (!trial) {
      return res.status(404).json({ success: false, message: 'Trial not found.' });
    }

    const previousStatus = trial.status;
    trial.status = 'completed';
    trial.trialOutcome = 'returned';
    trial.returnObserved = true;
    trial.completedAt = new Date();
    if (returnedItems.length > 0) trial.returnedItems = returnedItems;
    trial.events.push({
      type: 'marked_returned',
      actorId: req.user?.uid || 'admin',
      note: reason || `Marked as returned by admin. Returned ${returnedItems.length} items.`,
      createdAt: new Date(),
    });
    await trial.save();

    await createAuditEntry(req, {
      action: 'TRIAL_MARK_RETURNED',
      targetType: 'trial',
      targetId: id,
      message: `Marked returned. Items returned: ${returnedItems.length}. Status: ${previousStatus} → completed.`,
    });

    return res.status(200).json({ success: true, data: { id, status: trial.status } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getTrialDashboardMetrics,
  getTrialQueueHandler,
  getTrialDetailsHandler,
  getTrialAnalyticsHandler,
  assignRider,
  reschedule,
  cancelTrial,
  markPurchased,
  markReturned,
};
