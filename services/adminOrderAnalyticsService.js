const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');

class AdminOrderAnalyticsService {
  /**
   * Helper to compute the difference in minutes between two timestamps
   */
  _diffMinutes(start, end) {
    if (!start || !end) return null;
    const diff = new Date(end).getTime() - new Date(start).getTime();
    return diff / 60000;
  }

  /**
   * Computes SLA statuses and penalties for a single order
   */
  _computeOrderSlaAndHealth(order) {
    const timestamps = order.trackingTimestamps || {};
    
    // Vendor SLA (Placed -> Confirmed)
    let vendorSlaMinutes = this._diffMinutes(order.createdAt, timestamps.vendor_confirmed_at);
    let vendorSlaStatus = 'N/A';
    let vendorSlaPenalty = 0;
    
    if (vendorSlaMinutes !== null) {
      if (vendorSlaMinutes <= 30) {
        vendorSlaStatus = 'Healthy';
      } else if (vendorSlaMinutes <= 60) {
        vendorSlaStatus = 'Warning';
        vendorSlaPenalty = 10;
      } else {
        vendorSlaStatus = 'Critical';
        vendorSlaPenalty = 25;
      }
    }

    // Rider SLA (Assigned -> Picked Up)
    let riderSlaMinutes = this._diffMinutes(timestamps.rider_assigned_at, timestamps.picked_up_at);
    let riderSlaStatus = 'N/A';
    let riderSlaPenalty = 0;
    
    if (riderSlaMinutes !== null) {
      if (riderSlaMinutes <= 15) {
        riderSlaStatus = 'Healthy';
      } else if (riderSlaMinutes <= 30) {
        riderSlaStatus = 'Warning';
        riderSlaPenalty = 10;
      } else {
        riderSlaStatus = 'Critical';
        riderSlaPenalty = 25;
      }
    }

    // Delivery SLA (Picked Up -> Delivered)
    let deliverySlaMinutes = this._diffMinutes(timestamps.picked_up_at, timestamps.delivered_at);
    let deliverySlaStatus = 'N/A';
    let deliverySlaPenalty = 0;
    
    if (deliverySlaMinutes !== null) {
      // thresholds in minutes (2 hours = 120, 4 hours = 240)
      if (deliverySlaMinutes <= 120) {
        deliverySlaStatus = 'Healthy';
      } else if (deliverySlaMinutes <= 240) {
        deliverySlaStatus = 'Warning';
        deliverySlaPenalty = 10;
      } else {
        deliverySlaStatus = 'Critical';
        deliverySlaPenalty = 25;
      }
    }

    // Refund Risk Penalty
    let refundPenalty = 0;
    if (order.refundStatus === 'requested' || order.refundStatus === 'pending') refundPenalty = 15;
    if (order.refundStatus === 'refunded') refundPenalty = 30;

    // Complaint Risk Penalty (derive from customer ratings if present)
    let complaintPenalty = 0;
    if (order.customerDeliveryRating > 0 && order.customerDeliveryRating <= 2) complaintPenalty += 10;
    if (order.customerQualityRating > 0 && order.customerQualityRating <= 2) complaintPenalty += 10;

    // Order Health Score
    let healthScore = 100 - vendorSlaPenalty - riderSlaPenalty - refundPenalty - complaintPenalty;
    if (healthScore < 0) healthScore = 0;

    let healthClassification = 'Healthy';
    if (healthScore <= 59) {
      healthClassification = 'Critical';
    } else if (healthScore <= 79) {
      healthClassification = 'Warning';
    }

    return {
      vendorSlaStatus,
      vendorSlaMinutes,
      riderSlaStatus,
      riderSlaMinutes,
      deliverySlaStatus,
      deliverySlaMinutes,
      healthScore,
      healthClassification,
    };
  }

  /**
   * Generates the Order Dashboard Metrics
   */
  async getDashboardMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOrdersToday,
      pendingOrders,
      activeOrders,
      escalatedOrders,
      refundRequests,
      fulfillmentStats,
      slaBreaches
    ] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: today } }),
      Order.countDocuments({ orderStatus: { $in: ['pending', 'created'] } }),
      Order.countDocuments({ orderStatus: { $in: ['confirmed', 'processing', 'shipped'] } }),
      Order.countDocuments({ riskScore: { $gte: 60 } }), // Proxy for escalated for now
      Order.countDocuments({ refundStatus: { $in: ['requested', 'pending'] } }),
      
      // Fulfillment Velocity & Refund Rate Analytics
      Order.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$orderStatus', 'delivered'] }, 1, 0] } },
            refunded: { $sum: { $cond: [{ $eq: ['$refundStatus', 'refunded'] }, 1, 0] } },
          }
        }
      ]),

      // SLA Breaches calculation (simplified projection for active orders)
      Order.find({ orderStatus: { $nin: ['delivered', 'cancelled'] } }).lean()
    ]);

    let criticalSlaCount = 0;
    let warningSlaCount = 0;
    let totalAvgHealth = 0;
    let activeCount = 0;

    slaBreaches.forEach(order => {
      const sla = this._computeOrderSlaAndHealth(order);
      if (sla.healthClassification === 'Critical') criticalSlaCount++;
      if (sla.healthClassification === 'Warning') warningSlaCount++;
      
      totalAvgHealth += sla.healthScore;
      activeCount++;
    });

    const averageHealthScore = activeCount > 0 ? Math.round(totalAvgHealth / activeCount) : 100;
    const stats = fulfillmentStats[0] || { total: 0, completed: 0, refunded: 0 };
    const refundRate = stats.total > 0 ? ((stats.refunded / stats.total) * 100).toFixed(1) : 0;

    return {
      totalOrdersToday,
      pendingOrders,
      activeOrders,
      escalatedOrders: escalatedOrders + criticalSlaCount,
      refundRequests,
      refundRate: parseFloat(refundRate),
      criticalSlaCount,
      warningSlaCount,
      averageHealthScore,
    };
  }

  /**
   * Decorates an order with live SLA and Health data
   */
  async decorateOrderWithLiveMetrics(orderDoc) {
    const order = orderDoc.toObject ? orderDoc.toObject() : orderDoc;
    const slaMetrics = this._computeOrderSlaAndHealth(order);
    return { ...order, ...slaMetrics };
  }
}

module.exports = new AdminOrderAnalyticsService();
