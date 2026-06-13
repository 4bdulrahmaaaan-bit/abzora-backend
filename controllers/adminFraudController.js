const User = require('../models/User');
const Store = require('../models/Store');
const Order = require('../models/Order');
const AdminActivityLog = require('../models/AdminActivityLog');
const adminFraudAnalyticsService = require('../services/adminFraudAnalyticsService');

exports.getDashboard = async (req, res) => {
  try {
    const dashboard = await adminFraudAnalyticsService.getFraudDashboard();
    res.json({ success: true, data: dashboard });
  } catch (error) {
    console.error('Error fetching admin fraud dashboard:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Handles manual action for a given entity: review, suspend, block, whitelist
 */
exports.actionEntity = async (req, res) => {
  try {
    const { type, id } = req.params; // type: user, vendor, rider, order
    const { action, reason } = req.body; // action: review, suspend, block, whitelist
    
    let previousState = '';
    let newState = '';
    let entityRef = id;

    if (type === 'user' || type === 'rider') {
      const user = await User.findById(id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      previousState = `isFlagged: ${user.isFlagged}, isActive: ${user.isActive}`;
      
      if (action === 'suspend' || action === 'block') {
        user.isActive = false;
        user.isFlagged = true;
      } else if (action === 'whitelist') {
        user.isActive = true;
        user.isFlagged = false;
        user.fraudFlags = [];
        user.riskScore = 0;
      } else if (action === 'review') {
        user.isFlagged = true;
      }
      
      await user.save();
      newState = `isFlagged: ${user.isFlagged}, isActive: ${user.isActive}`;
    } 
    else if (type === 'vendor') {
      const store = await Store.findById(id).populate('vendorId');
      if (!store) return res.status(404).json({ success: false, message: 'Vendor not found' });
      previousState = `isActive: ${store.isActive}`;
      
      if (action === 'suspend' || action === 'block') {
        store.isActive = false;
        if (store.vendorId) {
          store.vendorId.isActive = false;
          store.vendorId.isFlagged = true;
          await store.vendorId.save();
        }
      } else if (action === 'whitelist') {
        store.isActive = true;
        if (store.vendorId) {
          store.vendorId.isActive = true;
          store.vendorId.isFlagged = false;
          store.vendorId.fraudFlags = [];
          store.vendorId.riskScore = 0;
          await store.vendorId.save();
        }
      } else if (action === 'review') {
        if (store.vendorId) {
          store.vendorId.isFlagged = true;
          await store.vendorId.save();
        }
      }
      
      await store.save();
      newState = `isActive: ${store.isActive}`;
    }
    else if (type === 'order') {
      const order = await Order.findById(id);
      if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
      previousState = `fraudStatus: ${order.fraudStatus}`;
      
      if (action === 'suspend' || action === 'block') {
        order.fraudStatus = 'blocked';
        order.isSuspicious = true;
      } else if (action === 'whitelist') {
        order.fraudStatus = 'clear';
        order.isSuspicious = false;
        order.fraudSignals = [];
        order.riskScore = 0;
      } else if (action === 'review') {
        order.fraudStatus = 'review';
        order.isSuspicious = true;
      }
      
      await order.save();
      newState = `fraudStatus: ${order.fraudStatus}`;
    }

    // Generate Audit Log
    if (req.user) {
      await AdminActivityLog.create({
        adminId: req.user.uid,
        action: `fraud_${action}`,
        entityType: type,
        entityId: entityRef,
        details: {
          reason,
          previousState,
          newState
        }
      });
    }

    res.json({ success: true, message: `Entity ${action}ed successfully.` });
  } catch (error) {
    console.error('Error actioning fraud entity:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
