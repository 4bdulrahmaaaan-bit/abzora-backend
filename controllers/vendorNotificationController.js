const vendorNotificationService = require('../services/vendorNotificationService');

exports.getNotifications = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { page, limit, priority, unreadOnly } = req.query;
    const data = await vendorNotificationService.getNotifications(vendorId, { page, limit, priority, unreadOnly });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const data = await vendorNotificationService.getUnreadCount(vendorId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const notification = await vendorNotificationService.markAsRead(id, vendorId);
    res.json(notification);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const result = await vendorNotificationService.markAllAsRead(vendorId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
