const Store = require('../models/Store');
const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');
const Review = require('../models/Review');
const User = require('../models/User');

class AdminVendorAnalyticsService {
  /**
   * Calculates the Vendor Health Score dynamically based on live data.
   * Formula: 
   * 35% Revenue Performance (relative to target or peers)
   * 25% Trial Conversion Rate
   * 20% Cancellation Rate (inverse)
   * 10% Customer Rating (normalized 0-100)
   * 10% Complaint Rate (inverse)
   */
  async computeHealthScore(storeId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // 1. Fetch Orders for Revenue & Cancellation Rate
    const orders = await Order.find({ storeId, createdAt: { $gte: thirtyDaysAgo } }).lean();
    let totalRevenue = 0;
    let cancelledCount = 0;
    let complaintCount = 0;
    
    orders.forEach(o => {
      if (o.orderStatus === 'cancelled') {
        cancelledCount++;
      } else {
        totalRevenue += (o.totalAmount || 0);
      }
      
      // Proxies for complaints: refund requested or very low rating on the order
      if (o.refundStatus === 'requested' || o.refundStatus === 'refunded') complaintCount++;
      if (o.customerQualityRating > 0 && o.customerQualityRating <= 2) complaintCount++;
    });

    const totalOrders = orders.length || 1;
    const cancellationRate = cancelledCount / totalOrders;
    const complaintRate = complaintCount / totalOrders;

    // Normalize revenue (Assuming ~50,000 INR per month is 100% score for baseline)
    let revScore = (totalRevenue / 50000) * 100;
    if (revScore > 100) revScore = 100;

    // 2. Fetch Trials for Conversion Rate
    const trials = await TrialHomeSession.find({ vendorId: storeId, createdAt: { $gte: thirtyDaysAgo } }).lean();
    let trialConverted = 0;
    trials.forEach(t => {
      if (t.trialOutcome === 'converted' || t.trialOutcome === 'partial_purchase') {
        trialConverted++;
      }
    });
    
    const trialConversionRate = trials.length > 0 ? (trialConverted / trials.length) : 0; // 0 to 1

    // 3. Fetch Store Rating
    const store = await Store.findById(storeId).select('rating customVendorProfile metrics vendorId').lean();
    const ratingScore = store ? (store.rating / 5) * 100 : 100;

    // Apply Weights
    // 35% Rev
    const weightedRev = revScore * 0.35;
    // 25% Trial
    const weightedTrial = (trialConversionRate * 100) * 0.25;
    // 20% Cancellation (inverse: 0% cancel = 100 pts)
    const cancelScore = Math.max(0, 100 - (cancellationRate * 100));
    const weightedCancel = cancelScore * 0.20;
    // 10% Rating
    const weightedRating = ratingScore * 0.10;
    // 10% Complaint (inverse: 0% complaint = 100 pts)
    const compScore = Math.max(0, 100 - (complaintRate * 100));
    const weightedComp = compScore * 0.10;

    let healthScore = Math.round(weightedRev + weightedTrial + weightedCancel + weightedRating + weightedComp);
    if (healthScore > 100) healthScore = 100;
    if (healthScore < 0) healthScore = 0;

    let classification = 'Healthy';
    if (healthScore <= 59) classification = 'Critical';
    else if (healthScore <= 79) classification = 'Warning';

    // Risk Score is somewhat inverse of health but incorporates specific fraud flags
    let riskScore = 100 - healthScore;
    // Boost risk if the user profile has fraud flags
    let fraudFlags = [];
    if (store && store.vendorId) {
      const vendorUser = await User.findById(store.vendorId).select('fraudFlags riskScore isFlagged').lean();
      if (vendorUser) {
        if (vendorUser.isFlagged) riskScore += 30;
        if (vendorUser.fraudFlags && vendorUser.fraudFlags.length > 0) {
          riskScore += (vendorUser.fraudFlags.length * 15);
          fraudFlags = vendorUser.fraudFlags;
        }
      }
    }
    if (riskScore > 100) riskScore = 100;
    
    let riskClassification = 'Healthy';
    if (riskScore >= 85) riskClassification = 'Critical';
    else if (riskScore >= 60) riskClassification = 'Warning';

    return {
      healthScore,
      healthClassification,
      riskScore,
      riskClassification,
      fraudFlags,
      analytics: {
        totalRevenue,
        cancellationRate: (cancellationRate * 100).toFixed(1) + '%',
        trialConversionRate: (trialConversionRate * 100).toFixed(1) + '%',
        complaintRate: (complaintRate * 100).toFixed(1) + '%',
        totalOrders,
        totalTrials: trials.length,
      }
    };
  }

  async getDashboardMetrics() {
    const stores = await Store.find({ isActive: true }).select('_id name').lean();
    let totalVendors = stores.length;
    let criticalCount = 0;
    let warningCount = 0;
    let totalHealth = 0;

    // Note: For a very large DB, we would run this via an aggregation cron job.
    // Since this is for the pilot admin panel, doing live Promise.all is acceptable.
    const scorePromises = stores.map(async s => {
      const metrics = await this.computeHealthScore(s._id);
      if (metrics.healthClassification === 'Critical') criticalCount++;
      if (metrics.healthClassification === 'Warning') warningCount++;
      totalHealth += metrics.healthScore;
      return { ...s, ...metrics };
    });

    const vendorScores = await Promise.all(scorePromises);
    const avgHealth = totalVendors > 0 ? Math.round(totalHealth / totalVendors) : 100;

    return {
      totalVendors,
      avgHealthScore: avgHealth,
      criticalVendors: criticalCount,
      warningVendors: warningCount,
      vendors: vendorScores.sort((a, b) => a.riskScore > b.riskScore ? -1 : 1) // highest risk first
    };
  }
}

module.exports = new AdminVendorAnalyticsService();
