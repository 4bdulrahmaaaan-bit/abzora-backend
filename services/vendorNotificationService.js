const VendorNotification = require('../models/VendorNotification');

class VendorNotificationService {
  async getNotifications(vendorId, options = {}) {
    const { page = 1, limit = 20, priority, unreadOnly } = options;
    const query = { vendorId };
    
    if (priority) query.priority = priority;
    if (unreadOnly) query.isRead = false;

    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      VendorNotification.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      VendorNotification.countDocuments(query)
    ]);

    return { notifications, total, page, limit };
  }

  async getUnreadCount(vendorId) {
    const count = await VendorNotification.countDocuments({ vendorId, isRead: false });
    return { count };
  }

  async markAsRead(notificationId, vendorId) {
    const notification = await VendorNotification.findOneAndUpdate(
      { _id: notificationId, vendorId },
      { isRead: true },
      { new: true }
    );
    if (!notification) throw new Error('Notification not found');
    return notification;
  }

  async markAllAsRead(vendorId) {
    await VendorNotification.updateMany({ vendorId, isRead: false }, { isRead: true });
    return { success: true };
  }
  async createNotification(vendorId, data) {
    const notification = await VendorNotification.create({
      vendorId,
      ...data,
    });
    
    // Try to send push notification
    try {
      const User = require('../models/User');
      const { sendMulticastNotification } = require('./notificationService');
      
      const vendorUser = await User.findOne({ 
        $or: [
          { _id: vendorId },
          { uid: vendorId },
          { storeId: vendorId }
        ]
      });
      
      if (vendorUser && vendorUser.fcmTokens && vendorUser.fcmTokens.length > 0) {
        await sendMulticastNotification(
          vendorUser.fcmTokens,
          data.title || 'Abianzo Vendor Update',
          data.message || 'You have a new notification.'
        );
      }
    } catch (err) {
      console.error('Failed to send vendor push notification', err);
    }
    
    return notification;
  }
}

module.exports = new VendorNotificationService();
