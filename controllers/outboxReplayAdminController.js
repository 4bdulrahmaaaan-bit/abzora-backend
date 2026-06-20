const PaymentOutboxEvent = require('../models/PaymentOutboxEvent');
const AdminActivityLog = require('../models/AdminActivityLog');
const { isAllowedAdminEmail } = require('./authController');
const { logSecurityEvent, logSecurityWarning } = require('../services/auditLogger');

function toIsoNow() {
  return new Date().toISOString();
}

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

function replayConfig() {
  return {
    cooldownMs: Math.max(0, Number(process.env.OUTBOX_MANUAL_REPLAY_COOLDOWN_MS || 60_000)),
    maxManualAttempts: Math.max(1, Number(process.env.OUTBOX_MANUAL_REPLAY_MAX_ATTEMPTS || 5)),
    leaseMs: Math.max(2_000, Number(process.env.OUTBOX_MANUAL_REPLAY_LEASE_MS || 20_000)),
  };
}

async function writeReplayAudit(req, { eventId, action, status, reason, message }) {
  const logId = `outbox-replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await AdminActivityLog.create({
    logId,
    actorId: req.user?.uid || 'admin',
    actorRole: req.user?.role || 'admin',
    action,
    targetType: 'payment_outbox_event',
    targetId: eventId,
    message: `${status.toUpperCase()}: ${message}. Reason: ${reason}`,
    timestampIso: toIsoNow(),
  });
}

async function replayDeadLetterEvent(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      await writeReplayAudit(req, {
        eventId: String(req.params?.eventId || ''),
        action: 'OUTBOX_DEADLETTER_REPLAY_ATTEMPT',
        status: 'denied',
        reason: String(req.body?.reason || '').trim() || 'missing',
        message: 'Unauthorized replay attempt',
      });
      return;
    }

    const eventId = String(req.params?.eventId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!eventId) {
      return res.status(400).json({ success: false, message: 'eventId is required.' });
    }
    if (!reason || reason.length < 8 || reason.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Replay reason is required (8-500 chars).',
      });
    }

    const { cooldownMs, maxManualAttempts, leaseMs } = replayConfig();
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + leaseMs);
    const cooldownCutoff = new Date(now.getTime() - cooldownMs);
    const operatorId = String(req.user?.uid || '');

    // Security hardening: atomic lease claim prevents concurrent manual replays.
    const claimed = await PaymentOutboxEvent.findOneAndUpdate(
      {
        eventId,
        deadLetter: true,
        status: { $in: ['failed', 'pending'] },
        $or: [{ lockExpiresAt: null }, { lockExpiresAt: { $lte: now } }],
        $or: [
          { 'metadata.lastManualReplayAt': { $exists: false } },
          { 'metadata.lastManualReplayAt': { $lt: cooldownCutoff.toISOString() } },
        ],
      },
      {
        $set: {
          status: 'processing',
          lockedBy: `manual-replay:${operatorId}`,
          lockExpiresAt,
          heartbeatAt: now,
          processingStartedAt: now,
        },
      },
      { new: true },
    );

    if (!claimed) {
      await writeReplayAudit(req, {
        eventId,
        action: 'OUTBOX_DEADLETTER_REPLAY_ATTEMPT',
        status: 'rejected',
        reason,
        message: 'Replay claim rejected due to lock/cooldown/state mismatch',
      });
      return res.status(409).json({
        success: false,
        message: 'Replay not allowed right now (event locked, cooling down, or not dead-letter).',
      });
    }

    const currentManualAttempts = Number(claimed?.metadata?.manualReplayAttempts || 0);
    if (currentManualAttempts >= maxManualAttempts) {
      await PaymentOutboxEvent.updateOne(
        { _id: claimed._id },
        {
          $set: {
            status: 'failed',
            lockExpiresAt: null,
            lockedBy: '',
            heartbeatAt: null,
            processingStartedAt: null,
            deadLetter: true,
            deadLetterReason: `manual_replay_limit_exceeded:${maxManualAttempts}`,
          },
        },
      );
      await writeReplayAudit(req, {
        eventId,
        action: 'OUTBOX_DEADLETTER_REPLAY_ATTEMPT',
        status: 'rejected',
        reason,
        message: 'Manual replay attempt limit exceeded',
      });
      return res.status(429).json({
        success: false,
        message: 'Manual replay attempt limit exceeded for this event.',
      });
    }

    const previousFailure = claimed.lastError || '';
    const previousDeadLetterReason = claimed.deadLetterReason || '';
    const previousAttempts = Number(claimed.attempts || 0);
    const metadata = {
      ...(claimed.metadata instanceof Map ? Object.fromEntries(claimed.metadata.entries()) : (claimed.metadata || {})),
      lastManualReplayAt: now.toISOString(),
      lastManualReplayBy: operatorId,
      lastManualReplayReason: reason,
      manualReplayAttempts: String(currentManualAttempts + 1),
      previousFailure,
      previousDeadLetterReason,
      previousAttempts: String(previousAttempts),
    };

    // Recovery behavior: safe requeue without resetting retry history.
    await PaymentOutboxEvent.updateOne(
      { _id: claimed._id },
      {
        $set: {
          status: 'pending',
          deadLetter: false,
          deadLetterReason: '',
          nextAttemptAt: new Date(),
          lastError: '',
          lastErrorAt: null,
          lockExpiresAt: null,
          lockedBy: '',
          heartbeatAt: null,
          processingStartedAt: null,
          metadata,
        },
      },
    );

    await writeReplayAudit(req, {
      eventId,
      action: 'OUTBOX_DEADLETTER_REPLAY_ATTEMPT',
      status: 'success',
      reason,
      message: 'Dead-letter event replay scheduled',
    });

    logSecurityEvent('outbox_deadletter_replay_scheduled', {
      requestId: req.requestId || '',
      eventId,
      operatorId,
    });

    return res.status(200).json({
      success: true,
      data: {
        eventId,
        status: 'pending',
        replayScheduled: true,
        // Security hardening: return only safe metadata, no raw payload exposure.
        replayMetadata: {
          manualReplayAttempts: currentManualAttempts + 1,
          previousAttempts,
          previousDeadLetterReason,
        },
      },
    });
  } catch (error) {
    try {
      await writeReplayAudit(req, {
        eventId: String(req.params?.eventId || ''),
        action: 'OUTBOX_DEADLETTER_REPLAY_ATTEMPT',
        status: 'failed',
        reason: String(req.body?.reason || '').trim() || 'unknown',
        message: String(error?.message || error),
      });
    } catch (_) {
      logSecurityWarning('outbox_deadletter_replay_audit_failed', {
        requestId: req.requestId || '',
        eventId: String(req.params?.eventId || ''),
      });
    }
    return next(error);
  }
}

module.exports = {
  replayDeadLetterEvent,
};
