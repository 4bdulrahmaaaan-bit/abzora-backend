const User = require('../models/User');
const Store = require('../models/Store');
const Order = require('../models/Order');
const TrialHomeSession = require('../models/TrialHomeSession');

class AdminFraudAnalyticsService {
  /**
   * Helper to normalize risk scores
   */
  _normalizeScore(score) {
    if (score < 0) return 0;
    if (score > 100) return 100;
    return score;
  }

  _classify(score) {
    if (score >= 85) return 'Critical';
    if (score >= 60) return 'Warning';
    return 'Healthy';
  }

  /**
   * Analyzes Customer Risk
   */
  async analyzeCustomer(userId) {
    const user = await User.findById(userId).lean();
    if (!user) return null;

    let riskScore = user.riskScore || 0;
    let flags = user.fraudFlags || [];
    
    // Check Returns (Proxy: Refund requested/refunded in last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const returns = await Order.countDocuments({
      userId: user.uid,
      refundStatus: { $in: ['requested', 'refunded'] },
      createdAt: { $gte: thirtyDaysAgo }
    });

    if (returns > 3 && !flags.includes('excessive_returns')) {
      flags.push('excessive_returns');
      riskScore += 40;
    }

    // Check Trials without purchase
    const trials = await TrialHomeSession.countDocuments({
      customerId: user.uid,
      trialOutcome: { $in: ['returned', 'cancelled'] },
      createdAt: { $gte: thirtyDaysAgo }
    });

    if (trials > 5 && !flags.includes('trial_abuse')) {
      flags.push('trial_abuse');
      riskScore += 30;
    }

    // Duplicate Phone / Device (basic proxy check)
    if (user.knownDeviceIds && user.knownDeviceIds.length > 3 && !flags.includes('multiple_devices')) {
      flags.push('multiple_devices');
      riskScore += 20;
    }

    if (user.isFlagged && !flags.includes('manual_flag')) {
      riskScore += 50;
    }

    riskScore = this._normalizeScore(riskScore);
    return {
      entityType: 'customer',
      entityId: user._id,
      name: user.name,
      uid: user.uid,
      riskScore,
      riskClassification: this._classify(riskScore),
      flags
    };
  }

  /**
   * Analyzes Vendor Risk
   */
  async analyzeVendor(storeId) {
    const store = await Store.findById(storeId).populate('vendorId').lean();
    if (!store) return null;

    let riskScore = 0;
    let flags = [];
    
    // Check Cancellations
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orders = await Order.find({ storeId, createdAt: { $gte: thirtyDaysAgo } }).select('orderStatus').lean();
    const totalOrders = orders.length || 1;
    const cancelled = orders.filter(o => o.orderStatus === 'cancelled').length;
    const cancelRate = cancelled / totalOrders;

    if (cancelRate > 0.15) {
      flags.push('high_cancellation_rate');
      riskScore += 30;
    }

    if (store.vendorId && store.vendorId.isFlagged) {
      flags.push('manual_flag');
      riskScore += 50;
    }
    
    if (store.vendorId && store.vendorId.fraudFlags) {
      flags = [...new Set([...flags, ...store.vendorId.fraudFlags])];
      riskScore += (store.vendorId.fraudFlags.length * 15);
    }

    riskScore = this._normalizeScore(riskScore);
    return {
      entityType: 'vendor',
      entityId: store._id,
      name: store.name,
      uid: store.ownerId,
      riskScore,
      riskClassification: this._classify(riskScore),
      flags
    };
  }

  /**
   * Analyzes Rider Risk
   */
  async analyzeRider(riderId) {
    const rider = await User.findOne({ uid: riderId, role: 'rider' }).lean();
    if (!rider) return null;

    let riskScore = rider.riskScore || 0;
    let flags = rider.fraudFlags || [];

    // Check Delivery failures
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const deliveries = await Order.find({ riderId, createdAt: { $gte: thirtyDaysAgo } }).select('deliveryStatus').lean();
    
    const totalDeliveries = deliveries.length || 1;
    const failed = deliveries.filter(d => d.deliveryStatus === 'Cancelled').length;
    const failRate = failed / totalDeliveries;

    if (failRate > 0.10 && !flags.includes('high_delivery_failure')) {
      flags.push('high_delivery_failure');
      riskScore += 30;
    }

    if (rider.isFlagged && !flags.includes('manual_flag')) {
      riskScore += 50;
    }

    riskScore = this._normalizeScore(riskScore);
    return {
      entityType: 'rider',
      entityId: rider._id,
      name: rider.name,
      uid: rider.uid,
      riskScore,
      riskClassification: this._classify(riskScore),
      flags
    };
  }

  /**
   * Generates Fraud Dashboard
   */
  async getFraudDashboard() {
    // For a production app this would query specific indexes or a pre-computed view.
    // For MVP we look for flagged users/stores directly.
    const [flaggedUsers, flaggedStores, flaggedOrders] = await Promise.all([
      User.find({ $or: [{ isFlagged: true }, { riskScore: { $gte: 60 } }] }).lean(),
      Store.find().populate('vendorId').lean(), // Need to filter post-populate for vendors
      Order.find({ $or: [{ isSuspicious: true }, { fraudStatus: { $ne: 'clear' } }] }).lean()
    ]);

    let customers = [];
    let riders = [];
    let vendors = [];

    flaggedUsers.forEach(u => {
      const risk = this._normalizeScore(u.riskScore || (u.isFlagged ? 85 : 0));
      const entity = {
        id: u._id,
        uid: u.uid,
        name: u.name,
        riskScore: risk,
        classification: this._classify(risk),
        flags: u.fraudFlags || (u.isFlagged ? ['manual_flag'] : [])
      };
      if (u.role === 'rider') riders.push(entity);
      else customers.push(entity);
    });

    flaggedStores.forEach(s => {
      if (s.vendorId && (s.vendorId.isFlagged || s.vendorId.riskScore >= 60)) {
        const risk = this._normalizeScore(s.vendorId.riskScore || (s.vendorId.isFlagged ? 85 : 0));
        vendors.push({
          id: s._id,
          uid: s.ownerId,
          name: s.name,
          riskScore: risk,
          classification: this._classify(risk),
          flags: s.vendorId.fraudFlags || (s.vendorId.isFlagged ? ['manual_flag'] : [])
        });
      }
    });

    const orders = flaggedOrders.map(o => {
      const risk = this._normalizeScore(o.riskScore || (o.isSuspicious ? 85 : 0));
      return {
        id: o._id,
        uid: o.userId,
        name: o.shippingAddress?.name || 'Unknown',
        riskScore: risk,
        classification: this._classify(risk),
        flags: o.fraudSignals || (o.isSuspicious ? ['suspicious_activity'] : [])
      };
    });

    // Combine all to find highest risk
    const allEntities = [...customers.map(c=>({...c, type:'Customer'})), 
                         ...riders.map(r=>({...r, type:'Rider'})), 
                         ...vendors.map(v=>({...v, type:'Vendor'})), 
                         ...orders.map(o=>({...o, type:'Order'}))];
    
    allEntities.sort((a, b) => b.riskScore - a.riskScore);
    const highestRisk = allEntities.slice(0, 10);

    return {
      flaggedCustomers: customers.length,
      flaggedVendors: vendors.length,
      flaggedRiders: riders.length,
      flaggedOrders: orders.length,
      highestRisk,
      customers: customers.sort((a,b) => b.riskScore - a.riskScore),
      vendors: vendors.sort((a,b) => b.riskScore - a.riskScore),
      riders: riders.sort((a,b) => b.riskScore - a.riskScore),
      orders: orders.sort((a,b) => b.riskScore - a.riskScore),
    };
  }
}

module.exports = new AdminFraudAnalyticsService();
