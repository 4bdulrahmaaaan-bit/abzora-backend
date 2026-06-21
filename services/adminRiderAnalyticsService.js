const User = require('../models/User');
const RiderPerformanceSnapshot = require('../models/RiderPerformanceSnapshot');
const RiderEarnings = require('../models/RiderEarnings');
const DeliveryTask = require('../models/DeliveryTask');
const TrialHomeSession = require('../models/TrialHomeSession');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ON_TIME_WINDOW_MS = 2 * 60 * 60 * 1000;

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function formatCurrency(value) {
  return `Rs ${Math.round(value).toLocaleString('en-IN')}`;
}

function classifyRisk(riskScore) {
  if (riskScore > 80) return 'Critical';
  if (riskScore > 60) return 'Warning';
  return 'Healthy';
}

function buildHealthScore({
  snapshot,
  deliveryStats,
  trialStats,
  rider,
}) {
  const acceptanceRate = clamp(toNumber(snapshot?.acceptanceRate, 92), 0, 100);
  const completionRate = clamp(toNumber(snapshot?.completionRate, 90), 0, 100);
  const customerRating = clamp(toNumber(snapshot?.customerRating, 4.5), 0, 5);
  const trialSuccessRate = clamp(
    trialStats?.trialSuccessRate ?? toNumber(snapshot?.trialSuccessRate, 90),
    0,
    100,
  );
  const noShowRate = clamp(toNumber(snapshot?.noShowRate, 0), 0, 100);
  const onTimeRate = clamp(deliveryStats?.onTimeRate ?? 90, 0, 100);

  const weighted =
    (acceptanceRate * 0.24) +
    (completionRate * 0.24) +
    ((customerRating / 5) * 100 * 0.18) +
    (trialSuccessRate * 0.16) +
    (onTimeRate * 0.12) +
    ((100 - noShowRate) * 0.06);

  const statusBonus = rider.riderApprovalStatus === 'approved' ? 4 : 0;
  const availabilityBonus = rider.riderAvailable === false ? -6 : 0;
  const flagPenalty = rider.isFlagged ? 12 : 0;

  return clamp(round(weighted + statusBonus + availabilityBonus - flagPenalty), 0, 100);
}

function buildDeliveryStats(tasks = []) {
  const stats = {
    assignedCount: 0,
    deliveredCount: 0,
    cancelledCount: 0,
    onTimeCount: 0,
  };

  for (const task of tasks) {
    stats.assignedCount += 1;
    if (task.status === 'delivered') {
      stats.deliveredCount += 1;
      const scheduledAt = task.scheduledAt ? new Date(task.scheduledAt) : null;
      const completedAt = task.completedAt ? new Date(task.completedAt) : null;
      if (
        scheduledAt &&
        completedAt &&
        !Number.isNaN(scheduledAt.getTime()) &&
        !Number.isNaN(completedAt.getTime()) &&
        (completedAt.getTime() - scheduledAt.getTime()) <= ON_TIME_WINDOW_MS
      ) {
        stats.onTimeCount += 1;
      }
    }
    if (task.status === 'cancelled') {
      stats.cancelledCount += 1;
    }
  }

  stats.completionRate = stats.assignedCount > 0
    ? round((stats.deliveredCount / stats.assignedCount) * 100, 1)
    : 0;
  stats.onTimeRate = stats.deliveredCount > 0
    ? round((stats.onTimeCount / stats.deliveredCount) * 100, 1)
    : 0;

  return stats;
}

function buildTrialStats(sessions = []) {
  const stats = {
    totalSessions: 0,
    completedSessions: 0,
    convertedSessions: 0,
    trialSuccessRate: 0,
  };

  for (const session of sessions) {
    stats.totalSessions += 1;
    const isCompleted =
      ['completed', 'converted_to_order', 'converted_to_tailoring'].includes(session.status) ||
      ['converted', 'returned', 'partial_purchase'].includes(session.trialOutcome);
    if (isCompleted) {
      stats.completedSessions += 1;
    }
    if (session.status === 'converted_to_order' || session.trialOutcome === 'converted') {
      stats.convertedSessions += 1;
    }
  }

  stats.trialSuccessRate = stats.totalSessions > 0
    ? round((stats.completedSessions / stats.totalSessions) * 100, 1)
    : 0;

  return stats;
}

class AdminRiderAnalyticsService {
  async getDashboardKPIs() {
    const riders = await User.find({ role: 'rider' })
      .select('uid name phone isActive riderApprovalStatus riderAvailable isFlagged riskScore')
      .lean();

    const riderIds = riders.map((rider) => rider.uid).filter(Boolean);
    if (!riderIds.length) {
      return {
        totalRiders: 0,
        activeRiders: 0,
        riderHealthScore: 0,
        riderRiskScore: 0,
        avgEarningsTrend: formatCurrency(0) + '/wk',
        avgTrialPerformance: '0%',
        avgDeliveryPerformance: '0%',
        slaPerformance: '0%',
        complaintRate: '0%',
        overallClassification: 'Healthy',
      };
    }

    const since30Days = new Date(Date.now() - THIRTY_DAYS_MS);
    const since7Days = new Date(Date.now() - SEVEN_DAYS_MS);

    const [snapshots, earnings, deliveryTasks, trialSessions] = await Promise.all([
      RiderPerformanceSnapshot.find({ riderId: { $in: riderIds } })
        .sort({ createdAt: -1 })
        .lean(),
      RiderEarnings.find({
        riderId: { $in: riderIds },
        createdAt: { $gte: since30Days },
        status: { $in: ['approved', 'paid'] },
      })
        .sort({ createdAt: -1 })
        .lean(),
      DeliveryTask.find({
        riderId: { $in: riderIds },
        createdAt: { $gte: since30Days },
      })
        .sort({ createdAt: -1 })
        .lean(),
      TrialHomeSession.find({
        riderId: { $in: riderIds },
        createdAt: { $gte: since30Days },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const latestSnapshotByRider = new Map();
    for (const snapshot of snapshots) {
      const riderId = String(snapshot.riderId || '');
      if (riderId && !latestSnapshotByRider.has(riderId)) {
        latestSnapshotByRider.set(riderId, snapshot);
      }
    }

    const earningsByRider = new Map();
    const weeklyEarningsByRider = new Map();
    for (const entry of earnings) {
      const riderId = String(entry.riderId || '');
      if (!riderId) continue;
      earningsByRider.set(
        riderId,
        (earningsByRider.get(riderId) || 0) + toNumber(entry.amount),
      );
      if (new Date(entry.createdAt).getTime() >= since7Days.getTime()) {
        weeklyEarningsByRider.set(
          riderId,
          (weeklyEarningsByRider.get(riderId) || 0) + toNumber(entry.amount),
        );
      }
    }

    const deliveryTasksByRider = new Map();
    for (const task of deliveryTasks) {
      const riderId = String(task.riderId || '');
      if (!riderId) continue;
      if (!deliveryTasksByRider.has(riderId)) {
        deliveryTasksByRider.set(riderId, []);
      }
      deliveryTasksByRider.get(riderId).push(task);
    }

    const trialSessionsByRider = new Map();
    for (const session of trialSessions) {
      const riderId = String(session.riderId || '');
      if (!riderId) continue;
      if (!trialSessionsByRider.has(riderId)) {
        trialSessionsByRider.set(riderId, []);
      }
      trialSessionsByRider.get(riderId).push(session);
    }

    const enrichedRiders = riders.map((rider) => {
      const riderId = String(rider.uid || '');
      const snapshot = latestSnapshotByRider.get(riderId) || null;
      const riderDeliveryStats = buildDeliveryStats(deliveryTasksByRider.get(riderId) || []);
      const riderTrialStats = buildTrialStats(trialSessionsByRider.get(riderId) || []);
      const healthScore = buildHealthScore({
        snapshot,
        deliveryStats: riderDeliveryStats,
        trialStats: riderTrialStats,
        rider,
      });
      const riskScore = clamp(round(100 - healthScore), 0, 100);
      const classification = classifyRisk(riskScore);
      const earningsValue = earningsByRider.get(riderId) || 0;

      return {
        _id: rider.uid,
        name: rider.name || 'N/A',
        phone: rider.phone || '',
        classification,
        healthScore,
        riskScore,
        earnings: Math.round(earningsValue),
        riderApprovalStatus: rider.riderApprovalStatus || 'pending',
      };
    });

    const activeRiders = riders.filter((rider) =>
      rider.isActive !== false &&
      rider.riderApprovalStatus === 'approved' &&
      rider.riderAvailable !== false,
    ).length;

    const totalHealth = enrichedRiders.reduce((sum, rider) => sum + toNumber(rider.healthScore), 0);
    const totalRisk = enrichedRiders.reduce((sum, rider) => sum + toNumber(rider.riskScore), 0);
    const totalWeeklyEarnings = Array.from(weeklyEarningsByRider.values()).reduce((sum, value) => sum + value, 0);
    const totalTrialSuccess = enrichedRiders.reduce((sum, rider) => sum + (100 - rider.riskScore), 0);
    const avgDeliveryPerformance = enrichedRiders.reduce((sum, rider) => {
      const snapshot = latestSnapshotByRider.get(String(rider._id)) || null;
      return sum + clamp(toNumber(snapshot?.completionRate, 0), 0, 100);
    }, 0);
    const flaggedCount = riders.filter((rider) => rider.isFlagged || rider.riskScore >= 75).length;

    const avgHealthScore = enrichedRiders.length ? round(totalHealth / enrichedRiders.length, 1) : 0;
    const avgRiskScore = enrichedRiders.length ? round(totalRisk / enrichedRiders.length, 1) : 0;
    const avgTrialPerformance = enrichedRiders.length
      ? round(trialSessions.length ? (trialSessions.filter((session) => ['completed', 'converted_to_order', 'converted_to_tailoring'].includes(session.status) || ['converted', 'returned', 'partial_purchase'].includes(session.trialOutcome)).length / trialSessions.length) * 100 : totalTrialSuccess / enrichedRiders.length, 1)
      : 0;
    const avgDeliveryRate = enrichedRiders.length ? round(avgDeliveryPerformance / enrichedRiders.length, 1) : 0;
    const complaintRate = riders.length ? round((flaggedCount / riders.length) * 100, 1) : 0;
    const classification = classifyRisk(avgRiskScore);
    const avgWeeklyEarnings = enrichedRiders.length ? totalWeeklyEarnings / enrichedRiders.length : 0;

    return {
      totalRiders: riders.length,
      activeRiders,
      riderHealthScore: avgHealthScore,
      riderRiskScore: avgRiskScore,
      avgEarningsTrend: `${formatCurrency(avgWeeklyEarnings)}/wk`,
      avgTrialPerformance: `${avgTrialPerformance}%`,
      avgDeliveryPerformance: `${avgDeliveryRate}%`,
      slaPerformance: `${avgDeliveryRate}%`,
      complaintRate: `${complaintRate}%`,
      overallClassification: classification,
    };
  }

  async getClassifiedRiders(classification) {
    const riders = await User.find({ role: 'rider' })
      .select('uid name phone riderApprovalStatus riderAvailable isActive isFlagged riskScore')
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (!riders.length) {
      return [];
    }

    const riderIds = riders.map((rider) => rider.uid).filter(Boolean);
    const since30Days = new Date(Date.now() - THIRTY_DAYS_MS);

    const [snapshots, earnings, deliveryTasks, trialSessions] = await Promise.all([
      RiderPerformanceSnapshot.find({ riderId: { $in: riderIds } })
        .sort({ createdAt: -1 })
        .lean(),
      RiderEarnings.find({
        riderId: { $in: riderIds },
        createdAt: { $gte: since30Days },
        status: { $in: ['approved', 'paid'] },
      }).lean(),
      DeliveryTask.find({
        riderId: { $in: riderIds },
        createdAt: { $gte: since30Days },
      }).lean(),
      TrialHomeSession.find({
        riderId: { $in: riderIds },
        createdAt: { $gte: since30Days },
      }).lean(),
    ]);

    const latestSnapshotByRider = new Map();
    for (const snapshot of snapshots) {
      const riderId = String(snapshot.riderId || '');
      if (riderId && !latestSnapshotByRider.has(riderId)) {
        latestSnapshotByRider.set(riderId, snapshot);
      }
    }

    const earningsByRider = new Map();
    for (const entry of earnings) {
      const riderId = String(entry.riderId || '');
      if (!riderId) continue;
      earningsByRider.set(
        riderId,
        (earningsByRider.get(riderId) || 0) + toNumber(entry.amount),
      );
    }

    const deliveryTasksByRider = new Map();
    for (const task of deliveryTasks) {
      const riderId = String(task.riderId || '');
      if (!riderId) continue;
      if (!deliveryTasksByRider.has(riderId)) {
        deliveryTasksByRider.set(riderId, []);
      }
      deliveryTasksByRider.get(riderId).push(task);
    }

    const trialSessionsByRider = new Map();
    for (const session of trialSessions) {
      const riderId = String(session.riderId || '');
      if (!riderId) continue;
      if (!trialSessionsByRider.has(riderId)) {
        trialSessionsByRider.set(riderId, []);
      }
      trialSessionsByRider.get(riderId).push(session);
    }

    const enriched = riders.map((rider) => {
      const riderId = String(rider.uid || '');
      const snapshot = latestSnapshotByRider.get(riderId) || null;
      const deliveryStats = buildDeliveryStats(deliveryTasksByRider.get(riderId) || []);
      const trialStats = buildTrialStats(trialSessionsByRider.get(riderId) || []);
      const healthScore = buildHealthScore({ snapshot, deliveryStats, trialStats, rider });
      const riskScore = clamp(round(100 - healthScore), 0, 100);
      const riderClassification = classifyRisk(riskScore);

      return {
        ...rider,
        classification: riderClassification,
        healthScore,
        riskScore,
        earnings: Math.round(earningsByRider.get(riderId) || 0),
      };
    });

    const filtered = classification
      ? enriched.filter((rider) => rider.classification === classification)
      : enriched;

    return filtered;
  }
}

module.exports = new AdminRiderAnalyticsService();
