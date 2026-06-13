const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');
const AdminActivityLog = require('../models/AdminActivityLog');
const adminOrderAnalyticsService = require('../services/adminOrderAnalyticsService');

/**
 * GET /admin/orders/dashboard
 * Retrieves top-level KPI metrics for Order Management V2
 */
exports.getDashboard = async (req, res) => {
  try {
    const metrics = await adminOrderAnalyticsService.getDashboardMetrics();
    res.json({ success: true, data: metrics });
  } catch (error) {
    console.error('Error fetching admin order dashboard:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /admin/orders/queue
 * Retrieves paginated list of orders with live SLA calculations
 */
exports.getQueue = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const skip = (page - 1) * limit;

    const { status, vendor, rider, search, health } = req.query;
    
    let query = {};
    if (status) query.orderStatus = status;
    if (vendor) query.storeId = vendor;
    if (rider) query.riderId = rider;

    if (search) {
      query.$or = [
        { _id: search.length === 24 ? search : null },
        { trackingId: new RegExp(search, 'i') },
        { 'shippingAddress.name': new RegExp(search, 'i') },
        { 'shippingAddress.phone': new RegExp(search, 'i') }
      ].filter(cond => cond !== null && Object.values(cond)[0] !== null);
    }

    // We do NOT filter by health initially since health is computed dynamically.
    // If we wanted to filter by health at the DB level we would need a cron job to sync it,
    // or run an aggregation. For MVP, we filter post-fetch if health is provided.
    // To handle pagination correctly with post-fetch filtering, we fetch a larger batch 
    // or just rely on status filtering first. Here we will do standard DB pagination.

    const [totalCount, orders] = await Promise.all([
      Order.countDocuments(query),
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('storeId', 'name vendorId ownerId')
        .lean()
    ]);

    // Enhance with live metrics
    let enhancedOrders = await Promise.all(
      orders.map(o => adminOrderAnalyticsService.decorateOrderWithLiveMetrics(o))
    );

    // Apply health filter if provided
    if (health) {
      enhancedOrders = enhancedOrders.filter(o => o.healthClassification.toLowerCase() === health.toLowerCase());
    }

    res.json({
      success: true,
      data: enhancedOrders,
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching admin order queue:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /admin/orders/:id
 * Retrieves full order details, populated with profiles
 */
exports.getOrderDetails = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('storeId')
      .lean();
      
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const enhancedOrder = await adminOrderAnalyticsService.decorateOrderWithLiveMetrics(order);

    // Fetch customer and rider profiles
    const [customer, rider] = await Promise.all([
      User.findOne({ uid: order.userId }).lean(),
      order.riderId ? User.findOne({ uid: order.riderId }).lean() : null
    ]);

    res.json({ 
      success: true, 
      data: {
        ...enhancedOrder,
        customerProfile: customer || null,
        riderProfile: rider || null,
      } 
    });
  } catch (error) {
    console.error('Error fetching admin order details:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /admin/orders/:id/timeline
 * Specifically extracts the tracking timeline
 */
exports.getOrderTimeline = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).select('trackingTimestamps createdAt').lean();
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, data: order.trackingTimestamps });
  } catch (error) {
    console.error('Error fetching order timeline:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /admin/orders/:id/history
 * Extracts payment, refund, and trial histories
 */
exports.getOrderHistory = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id)
      .select('paymentStatus refundStatus returnStatus trialOutcome isTrialOrder trialSessionId refundRequestId returnRequestId createdAt updatedAt escrowStatus payoutStatus payoutId')
      .lean();
      
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Error fetching order history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PATCH /admin/orders/:id/status
 * Admin override of order status with mandatory audit log entry.
 */
exports.overrideOrderStatus = async (req, res) => {
  try {
    const { status, reason } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'status is required' });

    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { orderStatus: status, updatedAt: new Date() },
      { new: true },
    ).lean();

    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    await AdminActivityLog.create({
      adminId: req.user?.uid || req.dbUser?._id?.toString() || 'system',
      adminEmail: req.user?.email || req.dbUser?.email || '',
      action: 'override_order_status',
      target: `order:${order._id}`,
      details: { previousStatus: order.orderStatus, newStatus: status, reason: reason || '' },
      timestamp: new Date(),
    });

    res.json({ success: true, data: order });
  } catch (error) {
    console.error('Error overriding order status:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
