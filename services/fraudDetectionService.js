const User = require('../models/User');
const Order = require('../models/Order');
const RefundRequest = require('../models/RefundRequest');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const FraudAlert = require('../models/FraudAlert');

function now() {
  return new Date();
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toTrimmed(value) {
  return value == null ? '' : String(value).trim();
}

function toSeverity(score) {
  if (score >= 80) {
    return 'critical';
  }
  if (score >= 55) {
    return 'high';
  }
  if (score >= 30) {
    return 'medium';
  }
  return 'low';
}

function toDecision(score) {
  if (score >= 70) {
    return 'block';
  }
  if (score >= 30) {
    return 'review';
  }
  return 'clear';
}

function fingerprintFromRequest(req) {
  return {
    ipAddress:
      toTrimmed(req.headers['x-forwarded-for']?.toString().split(',')[0]) ||
      toTrimmed(req.ip) ||
      toTrimmed(req.socket?.remoteAddress),
    deviceId:
      toTrimmed(req.headers['x-device-id']) ||
      toTrimmed(req.headers['x-abzora-device-id']) ||
      '',
    userAgent: toTrimmed(req.headers['user-agent']),
  };
}

function normalizeReasons(reasons = []) {
  return [...new Set(
    (Array.isArray(reasons) ? reasons : [])
      .map((reason) => toTrimmed(reason))
      .filter(Boolean),
  )];
}

function dedupeWindowStart(hours = 24) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function createFraudAlert({
  type,
  severity,
  userId = '',
  storeId = '',
  riderId = '',
  orderId = '',
  withdrawalRequestId = '',
  refundRequestId = '',
  riskScore = 0,
  reasons = [],
  message = '',
  ipAddress = '',
  deviceId = '',
  relatedOrderIds = [],
  metadata = {},
}) {
  const normalizedReasons = normalizeReasons(reasons);
  const normalizedMessage = toTrimmed(message);
  const normalizedIpAddress = toTrimmed(ipAddress);
  const normalizedDeviceId = toTrimmed(deviceId);
  const normalizedRelatedOrderIds = [...new Set(
    (Array.isArray(relatedOrderIds) ? relatedOrderIds : [])
      .map((value) => toTrimmed(value))
      .filter(Boolean),
  )];
  const normalizedMetadata = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]),
  );

  const existing = await FraudAlert.findOne({
    type,
    status: { $in: ['open', 'reviewing'] },
    userId: toTrimmed(userId),
    storeId: toTrimmed(storeId),
    riderId: toTrimmed(riderId),
    orderId: toTrimmed(orderId),
    withdrawalRequestId: toTrimmed(withdrawalRequestId),
    refundRequestId: toTrimmed(refundRequestId),
    ipAddress: normalizedIpAddress,
    deviceId: normalizedDeviceId,
    reasons: normalizedReasons,
    createdAt: { $gte: dedupeWindowStart() },
  }).sort({ createdAt: -1, _id: -1 });

  if (existing) {
    existing.severity = severity;
    existing.riskScore = Math.max(Number(existing.riskScore || 0), Number(riskScore || 0));
    existing.message = normalizedMessage || existing.message;
    existing.relatedOrderIds = [...new Set([
      ...(Array.isArray(existing.relatedOrderIds) ? existing.relatedOrderIds : []),
      ...normalizedRelatedOrderIds,
    ])].slice(-20);
    existing.metadata = {
      ...(existing.metadata instanceof Map ? Object.fromEntries(existing.metadata.entries()) : (existing.metadata || {})),
      ...normalizedMetadata,
      dedupeHits: String(Number(
        existing.metadata instanceof Map
          ? existing.metadata.get('dedupeHits') || 1
          : existing.metadata?.dedupeHits || 1,
      ) + 1),
      lastDedupedAt: now().toISOString(),
    };
    await existing.save();
    return existing;
  }

  const [alert] = await FraudAlert.create([
    {
      alertId: buildId(`fraud-${type}`),
      type,
      severity,
      status: 'open',
      userId: toTrimmed(userId),
      storeId: toTrimmed(storeId),
      riderId: toTrimmed(riderId),
      orderId: toTrimmed(orderId),
      withdrawalRequestId: toTrimmed(withdrawalRequestId),
      refundRequestId: toTrimmed(refundRequestId),
      riskScore,
      reasons: normalizedReasons,
      message: normalizedMessage,
      ipAddress: normalizedIpAddress,
      deviceId: normalizedDeviceId,
      relatedOrderIds: normalizedRelatedOrderIds,
      metadata: normalizedMetadata,
    },
  ]);
  return alert;
}

async function mergeUserFraudFlags(userId, { score = 0, reasons = [] }) {
  if (!userId) {
    return null;
  }
  const user = await User.findOne({ uid: userId });
  if (!user) {
    return null;
  }
  const mergedReasons = Array.from(
    new Set([...(Array.isArray(user.fraudFlags) ? user.fraudFlags : []), ...reasons]),
  ).slice(-10);
  user.riskScore = Math.max(Number(user.riskScore || 0), Number(score || 0));
  user.isFlagged = user.riskScore >= 30 || mergedReasons.length > 0;
  user.fraudFlags = mergedReasons;
  await user.save();
  return user;
}

async function recordUserNetworkContext(user, req) {
  if (!user) {
    return { duplicateIpUsers: 0, duplicateDeviceUsers: 0 };
  }
  const fingerprint = fingerprintFromRequest(req);
  const knownDeviceIds = new Set(Array.isArray(user.knownDeviceIds) ? user.knownDeviceIds : []);
  const recentIpAddresses = new Set(Array.isArray(user.recentIpAddresses) ? user.recentIpAddresses : []);
  if (fingerprint.deviceId) {
    knownDeviceIds.add(fingerprint.deviceId);
  }
  if (fingerprint.ipAddress) {
    recentIpAddresses.add(fingerprint.ipAddress);
  }
  user.lastKnownIp = fingerprint.ipAddress;
  user.lastKnownUserAgent = fingerprint.userAgent;
  user.knownDeviceIds = Array.from(knownDeviceIds).slice(-10);
  user.recentIpAddresses = Array.from(recentIpAddresses).slice(-10);
  await user.save();

  const [duplicateIpUsers, duplicateDeviceUsers] = await Promise.all([
    fingerprint.ipAddress
      ? User.countDocuments({
          uid: { $ne: user.uid },
          recentIpAddresses: fingerprint.ipAddress,
        })
      : 0,
    fingerprint.deviceId
      ? User.countDocuments({
          uid: { $ne: user.uid },
          knownDeviceIds: fingerprint.deviceId,
        })
      : 0,
  ]);

  const reasons = [];
  if (duplicateIpUsers >= 2) {
    reasons.push(`Multiple accounts detected on the same IP (${duplicateIpUsers + 1} users).`);
  }
  if (duplicateDeviceUsers >= 1) {
    reasons.push(`Multiple accounts detected on the same device (${duplicateDeviceUsers + 1} users).`);
  }
  if (reasons.length > 0) {
    await mergeUserFraudFlags(user.uid, { score: 35, reasons });
    await createFraudAlert({
      type: 'account',
      severity: 'high',
      userId: user.uid,
      riskScore: 35,
      reasons,
      message: 'Account fingerprint overlap detected.',
      ipAddress: fingerprint.ipAddress,
      deviceId: fingerprint.deviceId,
      metadata: {
        duplicateIpUsers,
        duplicateDeviceUsers,
      },
    });
  }

  return {
    duplicateIpUsers,
    duplicateDeviceUsers,
    fingerprint,
  };
}

async function evaluateOrderRisk({ user, store, req }) {
  const fingerprint = fingerprintFromRequest(req);
  const currentTime = now();
  const oneMinuteAgo = new Date(currentTime.getTime() - 60 * 1000);
  const oneHourAgo = new Date(currentTime.getTime() - 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(currentTime.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [ordersLastMinute, ordersLastHour, refundsLast30Days, duplicateIpUsers, duplicateDeviceUsers] =
    await Promise.all([
      Order.countDocuments({ userId: user.uid, createdAt: { $gte: oneMinuteAgo } }),
      Order.countDocuments({ userId: user.uid, createdAt: { $gte: oneHourAgo } }),
      RefundRequest.countDocuments({
        userId: user.uid,
        createdAt: { $gte: thirtyDaysAgo },
        status: { $in: ['requested', 'pending', 'approved', 'refunded'] },
      }),
      fingerprint.ipAddress
        ? User.countDocuments({
            uid: { $ne: user.uid },
            recentIpAddresses: fingerprint.ipAddress,
          })
        : 0,
      fingerprint.deviceId
        ? User.countDocuments({
            uid: { $ne: user.uid },
            knownDeviceIds: fingerprint.deviceId,
          })
        : 0,
    ]);

  let riskScore = 0;
  const reasons = [];

  if (ordersLastMinute >= 3) {
    riskScore += 60;
    reasons.push('Too many orders placed in a one-minute window.');
  } else if (ordersLastHour >= 4) {
    riskScore += 30;
    reasons.push('High order frequency detected in the last hour.');
  }

  if (refundsLast30Days >= 3) {
    riskScore += 20;
    reasons.push('Repeated refund requests detected on the account.');
  }

  if (store && String(store.ownerId || '') === String(user.uid || '')) {
    riskScore += 80;
    reasons.push('Vendor self-ordering detected.');
  }

  const accountAgeMs = currentTime.getTime() - new Date(user.createdAt || user.createdAtIso || currentTime).getTime();
  if (accountAgeMs < 2 * 24 * 60 * 60 * 1000) {
    riskScore += 10;
    reasons.push('New account placing purchase activity.');
  }

  if (duplicateDeviceUsers >= 1) {
    riskScore += 20;
    reasons.push('Shared device is being used across multiple accounts.');
  }

  if (duplicateIpUsers >= 2) {
    riskScore += 15;
    reasons.push('Shared IP is linked to multiple accounts.');
  }

  const decision = toDecision(riskScore);
  return {
    riskScore,
    reasons,
    decision,
    fingerprint,
  };
}

async function evaluateRefundRisk({ userId }) {
  const currentTime = now();
  const thirtyDaysAgo = new Date(currentTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [refundsLast30Days, recentOrders] = await Promise.all([
    RefundRequest.countDocuments({
      userId,
      createdAt: { $gte: thirtyDaysAgo },
    }),
    Order.countDocuments({
      userId,
      createdAt: { $gte: thirtyDaysAgo },
    }),
  ]);
  let riskScore = 0;
  const reasons = [];
  if (refundsLast30Days >= 3) {
    riskScore += 30;
    reasons.push('Repeated refund activity detected in the last 30 days.');
  }
  if (recentOrders > 0 && refundsLast30Days / recentOrders >= 0.5 && refundsLast30Days >= 2) {
    riskScore += 20;
    reasons.push('High refund ratio compared to placed orders.');
  }
  return {
    riskScore,
    reasons,
    decision: toDecision(riskScore),
  };
}

async function evaluateWithdrawalRisk({ user, wallet, walletType, amount }) {
  const currentTime = now();
  const oneDayAgo = new Date(currentTime.getTime() - 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(currentTime.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [requestsToday, withdrawals30Days] = await Promise.all([
    WithdrawalRequest.countDocuments({
      userId: user.uid,
      createdAt: { $gte: oneDayAgo },
      status: { $in: ['pending', 'manual_review', 'processing', 'completed', 'failed'] },
    }),
    WithdrawalRequest.countDocuments({
      userId: user.uid,
      createdAt: { $gte: thirtyDaysAgo },
      status: { $in: ['completed', 'processing', 'pending', 'manual_review'] },
    }),
  ]);

  if (requestsToday >= 3) {
    return {
      riskScore: 100,
      reasons: ['Daily withdrawal request limit exceeded.'],
      decision: 'block',
    };
  }

  let riskScore = 0;
  const reasons = [];
  const accountAgeMs = currentTime.getTime() - new Date(user.createdAt || currentTime).getTime();
  const safeAmount = Number(amount || 0);
  const availableBalance = Number(wallet.balance || 0) + safeAmount;

  if (accountAgeMs < 7 * 24 * 60 * 60 * 1000) {
    riskScore += 10;
    reasons.push('New account requested a payout.');
  }
  if (safeAmount >= Math.max(25000, availableBalance * 0.8)) {
    riskScore += 25;
    reasons.push('Unusually large withdrawal amount requested.');
  }
  if (withdrawals30Days >= 5) {
    riskScore += 20;
    reasons.push('High withdrawal frequency detected.');
  }
  if (requestsToday >= 1) {
    riskScore += 25;
    reasons.push('Rapid repeat withdrawal request detected today.');
  }
  if (user.isFlagged) {
    riskScore += 35;
    reasons.push('User account is already flagged for fraud review.');
  }
  if (walletType === 'vendor' && !user.storeId) {
    riskScore += 50;
    reasons.push('Vendor payout requested without an active linked store.');
  }

  return {
    riskScore,
    reasons,
    decision: toDecision(riskScore),
  };
}

module.exports = {
  createFraudAlert,
  evaluateOrderRisk,
  evaluateRefundRisk,
  evaluateWithdrawalRisk,
  fingerprintFromRequest,
  mergeUserFraudFlags,
  recordUserNetworkContext,
  toDecision,
  toSeverity,
};
