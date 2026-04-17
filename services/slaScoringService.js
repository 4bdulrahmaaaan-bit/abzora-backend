const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');

function safeRate(numerator, denominator) {
  if (!denominator || denominator <= 0) return 0;
  return numerator / denominator;
}

async function vendorSlaScore({ vendorId = '', storeId = '' }) {
  const orderFilter = {};
  if (storeId) {
    orderFilter.storeId = storeId;
  }
  const orders = await Order.find(orderFilter)
    .select('orderStatus returnStatus deliveryStatus createdAt updatedAt')
    .sort({ createdAt: -1 })
    .limit(1500)
    .lean();

  const totalOrders = orders.length;
  const accepted = orders.filter((order) => ['confirmed', 'processing', 'shipped', 'delivered'].includes(order.orderStatus)).length;
  const delivered = orders.filter((order) => order.orderStatus === 'delivered').length;
  const returned = orders.filter((order) => order.returnStatus && order.returnStatus !== 'none' && order.returnStatus !== 'rejected').length;

  const acceptanceRate = safeRate(accepted, totalOrders);
  const onTimeReadyRate = safeRate(
    orders.filter((order) => ['Ready for pickup', 'Assigned', 'Picked up', 'Out for delivery', 'Delivered'].includes(order.deliveryStatus)).length,
    totalOrders,
  );
  const returnRate = safeRate(returned, Math.max(delivered, 1));

  const score = Math.max(
    0,
    Math.min(
      100,
      (acceptanceRate * 40 + onTimeReadyRate * 40 + (1 - returnRate) * 20) * 100,
    ),
  );

  const trials = await TrialHomeSession.find({
    ...(vendorId ? { 'events.actorId': vendorId } : {}),
  })
    .select('status')
    .limit(500)
    .lean();
  const trialConverted = trials.filter((session) => ['converted_to_order', 'converted_to_tailoring'].includes(session.status)).length;

  return {
    acceptanceRate,
    onTimeReadyRate,
    returnRate,
    trialConversionRate: safeRate(trialConverted, trials.length),
    score,
    tier: score >= 85 ? 'elite' : score >= 70 ? 'trusted' : score >= 50 ? 'watchlist' : 'risk',
  };
}

async function riderSlaScore({ riderId }) {
  const tasks = await DeliveryTask.find({ riderId })
    .select('status routeDurationMins createdAt updatedAt sameDay')
    .sort({ createdAt: -1 })
    .limit(2000)
    .lean();
  const completed = tasks.filter((task) => task.status === 'delivered');
  const successRate = safeRate(completed.length, tasks.length);
  const sameDaySuccess = safeRate(
    tasks.filter((task) => task.sameDay && task.status === 'delivered').length,
    tasks.filter((task) => task.sameDay).length || 1,
  );
  const avgDuration = completed.length > 0
    ? completed.reduce((sum, task) => sum + Number(task.routeDurationMins || 0), 0) / completed.length
    : 0;
  const speedScore = Math.max(0, Math.min(1, 1 - (avgDuration / 120)));
  const score = Math.max(
    0,
    Math.min(100, (successRate * 55 + sameDaySuccess * 25 + speedScore * 20) * 100),
  );
  return {
    successRate,
    sameDaySuccessRate: sameDaySuccess,
    avgTaskDurationMins: avgDuration,
    score,
    tier: score >= 85 ? 'elite' : score >= 70 ? 'trusted' : score >= 50 ? 'watchlist' : 'risk',
  };
}

module.exports = {
  vendorSlaScore,
  riderSlaScore,
};
