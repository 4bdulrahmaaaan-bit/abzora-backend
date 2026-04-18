require('dotenv').config();
const mongoose = require('mongoose');
const FraudAlert = require('../models/FraudAlert');

function normalizeReasons(reasons = []) {
  return [...new Set(
    (Array.isArray(reasons) ? reasons : [])
      .map((reason) => String(reason || '').trim())
      .filter(Boolean)
      .sort(),
  )];
}

function duplicateKey(alert) {
  return JSON.stringify({
    type: String(alert.type || '').trim(),
    userId: String(alert.userId || '').trim(),
    storeId: String(alert.storeId || '').trim(),
    riderId: String(alert.riderId || '').trim(),
    orderId: String(alert.orderId || '').trim(),
    withdrawalRequestId: String(alert.withdrawalRequestId || '').trim(),
    refundRequestId: String(alert.refundRequestId || '').trim(),
    ipAddress: String(alert.ipAddress || '').trim(),
    deviceId: String(alert.deviceId || '').trim(),
    reasons: normalizeReasons(alert.reasons),
    severity: String(alert.severity || '').trim(),
  });
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const applyChanges = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const alerts = await FraudAlert.find({
    status: { $in: ['open', 'reviewing'] },
  }).sort({ createdAt: -1, _id: -1 });

  const grouped = new Map();
  for (const alert of alerts) {
    const key = duplicateKey(alert);
    const list = grouped.get(key) || [];
    list.push(alert);
    grouped.set(key, list);
  }

  const duplicateGroups = [...grouped.values()].filter((group) => group.length > 1);
  const duplicateIdsToClose = duplicateGroups.flatMap((group) => group.slice(1).map((alert) => alert._id));

  const report = {
    scannedOpenAlerts: alerts.length,
    duplicateGroups: duplicateGroups.length,
    duplicateAlertsToIgnore: duplicateIdsToClose.length,
    examples: duplicateGroups.slice(0, 10).map((group) => ({
      keptAlertId: group[0].alertId,
      ignoredAlertIds: group.slice(1).map((alert) => alert.alertId),
      reasonSample: normalizeReasons(group[0].reasons).slice(0, 3),
      userId: group[0].userId || '',
      severity: group[0].severity || '',
    })),
    mode: applyChanges ? 'apply' : 'dry-run',
  };

  if (applyChanges && duplicateIdsToClose.length > 0) {
    const reviewedAt = new Date().toISOString();
    const result = await FraudAlert.updateMany(
      { _id: { $in: duplicateIdsToClose } },
      {
        $set: {
          status: 'ignored',
          reviewedBy: 'system-dedupe',
          reviewedAt,
          message: 'Ignored as duplicate fraud alert during dedupe cleanup.',
        },
      },
    );
    report.modifiedCount = result.modifiedCount || 0;
    report.reviewedAt = reviewedAt;
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
  });
