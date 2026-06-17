const mongoose = require('mongoose');

const PayoutRecoveryJob = require('../models/PayoutRecoveryJob');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { recordFinanceAudit, markWithdrawalCompleted, markWithdrawalFailed } = require('./financeService');
const { createPayout, getPayoutStatus } = require('./razorpayPayoutService');

function nowIso() {
  return new Date().toISOString();
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function toDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isOlderThanMinutes(dateValue, minutes) {
  const date = toDate(dateValue);
  if (!date) {
    return false;
  }
  return Date.now() - date.getTime() >= minutes * 60 * 1000;
}

function mapRazorpayPayoutStatus(status) {
  const normalized = normalizeStatus(status);
  if (['processed', 'paid', 'completed'].includes(normalized)) {
    return 'paid';
  }
  if (['failed', 'rejected'].includes(normalized)) {
    return 'failed';
  }
  if (['reversed', 'returned'].includes(normalized)) {
    return 'reversed';
  }
  if (['cancelled', 'canceled'].includes(normalized)) {
    return 'cancelled';
  }
  if (['queued', 'initiated', 'pending', 'processing'].includes(normalized)) {
    return 'processing';
  }
  return 'unknown';
}

async function upsertRecoveryJob(request, { payoutId = '', status = 'pending', failureReason = '', metadata = {} } = {}, session = null) {
  const payload = {
    userId: request.userId,
    userRole: request.walletType,
    razorpayPayoutId: payoutId || request.payoutId || '',
    status,
    attemptCount: 0,
    lastCheckedAt: nowIso(),
    failureReason,
    metadata: Object.fromEntries(
      Object.entries({
        ...metadata,
        walletType: request.walletType,
        requestStatus: request.status || '',
        payoutId: payoutId || request.payoutId || '',
        approvalLockId: request.approvalLockId || '',
        idempotencyKey: request.idempotencyKey || '',
      }).map(([key, value]) => [key, String(value ?? '')]),
    ),
  };
  return PayoutRecoveryJob.findOneAndUpdate(
    { withdrawalRequestId: request.requestId },
    { $set: payload, $setOnInsert: { withdrawalRequestId: request.requestId } },
    { new: true, upsert: true },
  ).session(session);
}

async function resolveWithdrawalByRazorpayStatus(request, payoutStatus, session = null) {
  const normalized = mapRazorpayPayoutStatus(payoutStatus);
  if (normalized === 'paid') {
    return markWithdrawalCompleted({
      requestId: request.requestId,
      payoutId: request.payoutId,
      processedBy: 'payout-recovery',
    });
  }
  if (normalized === 'failed' || normalized === 'reversed' || normalized === 'cancelled') {
    return markWithdrawalFailed({
      requestId: request.requestId,
      payoutId: request.payoutId,
      reason: `RazorpayX payout status is ${normalized}.`,
      processedBy: 'payout-recovery',
      finalStatus: normalized,
    });
  }
  return null;
}

async function recoverSingleWithdrawal(request, { staleMinutes = 5, triggeredBy = 'payout-recovery' } = {}) {
  const session = await mongoose.startSession();
  let job = null;
  try {
    await session.withTransaction(async () => {
      job = await upsertRecoveryJob(request, { status: 'investigating' }, session);
      job.attemptCount = Number(job.attemptCount || 0) + 1;
      job.lastCheckedAt = nowIso();
      await job.save({ session });
    });
  } finally {
    await session.endSession();
  }

  const requestStatus = normalizeStatus(request.status);
  const stale = isOlderThanMinutes(request.updatedAt || request.createdAt, staleMinutes);
  const hasPayoutId = Boolean(request.payoutId || job?.razorpayPayoutId);
  const payoutId = request.payoutId || job?.razorpayPayoutId || '';
  const idempotencyKey = request.idempotencyKey || '';

  if (!stale && requestStatus !== 'approved' && requestStatus !== 'processing') {
    return { job, resolved: false, reason: 'not_stale' };
  }

  if (!hasPayoutId && idempotencyKey && ['approved', 'processing'].includes(requestStatus)) {
    try {
      const payout = await createPayout({
        fundAccountId: request.razorpayFundAccountId,
        amount: Number(request.amount || 0),
        mode: request.payoutMode || 'IMPS',
        referenceId: request.requestId,
        idempotencyKey,
        narration: `${request.walletType} withdrawal`,
        notes: {
          withdrawalRequestId: request.requestId,
          walletType: request.walletType,
          userId: request.userId,
          recoveryMode: 'true',
        },
      });
      request.payoutId = payout.id || '';
      request.status = 'processing';
      request.processingStartedAt = request.processingStartedAt || nowIso();
      await request.save();
      job.razorpayPayoutId = request.payoutId;
      job.status = 'investigating';
      job.failureReason = '';
      const jobMetadata = job.metadata ? Object.fromEntries(job.metadata) : {};
      job.metadata = new Map(
        Object.entries({
          ...jobMetadata,
          recoveryMethod: 'idempotency_replay',
        }),
      );
      await job.save();
      const immediateStatus = payout?.status || payout?.entity?.status || '';
      if (request.payoutId && mapRazorpayPayoutStatus(immediateStatus) !== 'processing' && mapRazorpayPayoutStatus(immediateStatus) !== 'unknown') {
        const resolved = await resolveWithdrawalByRazorpayStatus(request, immediateStatus);
        if (resolved) {
          job.status = 'recovered';
          job.resolvedAt = nowIso();
          job.failureReason = '';
          await job.save();
          await recordFinanceAudit({
            action: 'payout_recovery',
            actorId: triggeredBy,
            actorRole: 'system',
            status: 'success',
            walletType: request.walletType,
            storeId: request.storeId || '',
            riderId: request.riderId || '',
            withdrawalRequestId: request.requestId,
            payoutId: request.payoutId || '',
            amount: Number(request.amount || 0),
            message: 'Recovered payout via idempotent replay response.',
            metadata: {
              statusBefore: requestStatus,
              statusAfter: resolved.status || '',
              resolutionMethod: 'idempotency_replay',
              payoutStatus: String(immediateStatus || ''),
            },
          });
          return { job, resolved: true, request: resolved };
        }
      }
      if (request.payoutId) {
        const statusPayload = await getPayoutStatus(request.payoutId);
        const payoutStatus = statusPayload?.status || statusPayload?.entity?.status || '';
        const resolved = await resolveWithdrawalByRazorpayStatus(request, payoutStatus);
        if (resolved) {
          job.status = 'recovered';
          job.resolvedAt = nowIso();
          job.failureReason = '';
          await job.save();
          await recordFinanceAudit({
            action: 'payout_recovery',
            actorId: triggeredBy,
            actorRole: 'system',
            status: 'success',
            walletType: request.walletType,
            storeId: request.storeId || '',
            riderId: request.riderId || '',
            withdrawalRequestId: request.requestId,
            payoutId: request.payoutId || '',
            amount: Number(request.amount || 0),
            message: 'Recovered payout via idempotent replay.',
            metadata: {
              statusBefore: requestStatus,
              statusAfter: resolved.status || '',
              resolutionMethod: 'idempotency_replay',
            },
          });
          return { job, resolved: true, request: resolved };
        }
      }
    } catch (error) {
      job.status = 'manual_review';
      job.failureReason = error.message || 'Payout replay recovery failed.';
      await job.save();
      await recordFinanceAudit({
        action: 'payout_recovery',
        actorId: triggeredBy,
        actorRole: 'system',
        status: 'failed',
        walletType: request.walletType,
        storeId: request.storeId || '',
        riderId: request.riderId || '',
        withdrawalRequestId: request.requestId,
        payoutId: request.payoutId || '',
        amount: Number(request.amount || 0),
        message: error.message || 'Payout replay recovery failed.',
        metadata: {
          statusBefore: requestStatus,
          resolutionMethod: 'idempotency_replay',
        },
      });
      return { job, resolved: false, reason: error.message };
    }
  }

  if (!payoutId) {
    job.status = 'manual_review';
    job.failureReason = 'Missing RazorpayX payout reference.';
    await job.save();
    await recordFinanceAudit({
      action: 'payout_recovery',
      actorId: triggeredBy,
      actorRole: 'system',
      status: 'failed',
      walletType: request.walletType,
      storeId: request.storeId || '',
      riderId: request.riderId || '',
      withdrawalRequestId: request.requestId,
      payoutId: '',
      amount: Number(request.amount || 0),
      message: 'Missing RazorpayX payout reference.',
      metadata: {
        statusBefore: requestStatus,
        resolutionMethod: 'manual_review',
      },
    });
    return { job, resolved: false, reason: 'missing_payout_reference' };
  }

  try {
    const payout = await getPayoutStatus(payoutId);
    const payoutStatus = payout?.status || payout?.entity?.status || payout?.entity?.state || '';
    const normalized = mapRazorpayPayoutStatus(payoutStatus);
    if (normalized === 'processing' || normalized === 'unknown') {
      job.status = 'investigating';
      job.razorpayPayoutId = payoutId;
      job.failureReason = normalized === 'unknown' ? 'Unrecognized payout status.' : '';
      await job.save();
      return { job, resolved: false, reason: normalized };
    }
    const resolved = await resolveWithdrawalByRazorpayStatus(request, payoutStatus);
    if (!resolved) {
      job.status = 'manual_review';
      job.razorpayPayoutId = payoutId;
      job.failureReason = `Unhandled payout status: ${payoutStatus || 'unknown'}`;
      await job.save();
      return { job, resolved: false, reason: payoutStatus || 'unknown' };
    }
    job.status = 'recovered';
    job.razorpayPayoutId = payoutId;
    job.resolvedAt = nowIso();
    job.failureReason = '';
    await job.save();
    await recordFinanceAudit({
      action: 'payout_recovery',
      actorId: triggeredBy,
      actorRole: 'system',
      status: 'success',
      walletType: request.walletType,
      storeId: request.storeId || '',
      riderId: request.riderId || '',
      withdrawalRequestId: request.requestId,
      payoutId,
      amount: Number(request.amount || 0),
      message: 'Recovered payout from RazorpayX reconciliation.',
      metadata: {
        statusBefore: requestStatus,
        statusAfter: resolved.status || '',
        resolutionMethod: 'razorpay_reconciliation',
        payoutStatus: String(payoutStatus || ''),
      },
    });
    return { job, resolved: true, request: resolved };
  } catch (error) {
    job.status = 'manual_review';
    job.razorpayPayoutId = payoutId;
    job.failureReason = error.message || 'RazorpayX reconciliation failed.';
    await job.save();
    await recordFinanceAudit({
      action: 'payout_recovery',
      actorId: triggeredBy,
      actorRole: 'system',
      status: 'failed',
      walletType: request.walletType,
      storeId: request.storeId || '',
      riderId: request.riderId || '',
      withdrawalRequestId: request.requestId,
      payoutId,
      amount: Number(request.amount || 0),
      message: error.message || 'RazorpayX reconciliation failed.',
      metadata: {
        statusBefore: requestStatus,
        resolutionMethod: 'razorpay_reconciliation',
      },
    });
    return { job, resolved: false, reason: error.message };
  }
}

async function runPayoutRecoverySweep({ staleMinutes = 5, limit = 100, triggeredBy = 'payout-recovery' } = {}) {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  const candidates = await WithdrawalRequest.find({
    status: { $in: ['approved', 'processing'] },
    updatedAt: { $lte: cutoff },
  })
    .sort({ updatedAt: 1, _id: 1 })
    .limit(limit);

  const results = {
    scanned: candidates.length,
    recovered: [],
    manualReview: [],
    failed: [],
    ignored: [],
  };

  for (const request of candidates) {
    try {
      const outcome = await recoverSingleWithdrawal(request, { staleMinutes, triggeredBy });
      if (outcome.resolved) {
        results.recovered.push(request.requestId);
      } else if (outcome.reason === 'missing_payout_reference' || outcome.reason === 'unknown') {
        results.manualReview.push(request.requestId);
      } else {
        results.ignored.push(request.requestId);
      }
    } catch (error) {
      results.failed.push({ requestId: request.requestId, error: error.message });
    }
  }

  return results;
}

async function listRecoveryJobs(filter = {}) {
  return PayoutRecoveryJob.find(filter).sort({ updatedAt: -1, _id: -1 });
}

module.exports = {
  listRecoveryJobs,
  mapRazorpayPayoutStatus,
  recoverSingleWithdrawal,
  runPayoutRecoverySweep,
};
