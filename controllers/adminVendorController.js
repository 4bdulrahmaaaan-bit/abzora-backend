const Store = require('../models/Store');
const Order = require('../models/Order');
const AdminActivityLog = require('../models/AdminActivityLog');
const adminVendorAnalyticsService = require('../services/adminVendorAnalyticsService');

exports.getDashboard = async (req, res) => {
  try {
    const metrics = await adminVendorAnalyticsService.getDashboardMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    console.error('Error fetching admin vendor dashboard:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getVendorDetails = async (req, res) => {
  try {
    const store = await Store.findById(req.params.id)
      .populate('vendorId', 'name email phone profileImageUrl isActive isFlagged fraudFlags riskScore roles')
      .lean();
      
    if (!store) {
      return res.status(404).json({ success: false, message: 'Vendor not found' });
    }

    const liveAnalytics = await adminVendorAnalyticsService.computeHealthScore(store._id);

    res.json({ 
      success: true, 
      data: {
        ...store,
        ...liveAnalytics
      } 
    });
  } catch (error) {
    console.error('Error fetching admin vendor details:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getVendorAnalytics = async (req, res) => {
  try {
    const liveAnalytics = await adminVendorAnalyticsService.computeHealthScore(req.params.id);
    res.json({ success: true, data: liveAnalytics });
  } catch (error) {
    console.error('Error fetching vendor analytics:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getVendorPayouts = async (req, res) => {
  try {
    // We proxy through Orders since payouts are attached there in this schema
    const payouts = await Order.find({ 
      storeId: req.params.id, 
      payoutStatus: { $ne: 'none' } 
    })
    .select('payoutStatus payoutId totalAmount vendorEarnings createdAt updatedAt')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    res.json({ success: true, data: payouts });
  } catch (error) {
    console.error('Error fetching vendor payouts:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

exports.getVendorComplaints = async (req, res) => {
  try {
    // Proxies for complaints: orders with refunds or bad ratings
    const complaints = await Order.find({ 
      storeId: req.params.id,
      $or: [
        { refundStatus: { $in: ['requested', 'pending', 'refunded'] } },
        { customerQualityRating: { $gte: 1, $lte: 2 } },
        { customerDeliveryRating: { $gte: 1, $lte: 2 } }
      ]
    })
    .select('_id refundStatus customerQualityRating customerDeliveryRating customerFitFeedbackNotes createdAt')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

    res.json({ success: true, data: complaints });
  } catch (error) {
    console.error('Error fetching vendor complaints:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /admin/vendors/:id/suspend
 * Suspend or reinstate a vendor store with mandatory audit log entry.
 */
exports.setSuspendVendor = async (req, res) => {
  try {
    const { suspend, reason } = req.body;
    const isActive = suspend === true ? false : true;

    const store = await Store.findByIdAndUpdate(
      req.params.id,
      { isActive, updatedAt: new Date() },
      { new: true },
    ).lean();

    if (!store) return res.status(404).json({ success: false, message: 'Vendor not found' });

    await AdminActivityLog.create({
      adminId: req.user?.uid || req.dbUser?._id?.toString() || 'system',
      adminEmail: req.user?.email || req.dbUser?.email || '',
      action: suspend ? 'suspend_vendor' : 'reinstate_vendor',
      target: `store:${store._id}`,
      details: { storeName: store.name, reason: reason || '' },
      timestamp: new Date(),
    });

    res.json({ success: true, data: store });
  } catch (error) {
    console.error('Error suspending vendor:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
