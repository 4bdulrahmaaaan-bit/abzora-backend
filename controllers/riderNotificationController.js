const AdminNotification = require('../models/AdminNotification');

function riderNotificationQuery(userId) {
  return {
    audienceRole: 'rider',
    $or: [{ userId }, { userId: '' }, { userId: null }],
  };
}

exports.getNotifications = async (req, res) => {
  try {
    const userId = String(req.user?.uid || '').trim();
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const query = riderNotificationQuery(userId);
    const [notifications, total] = await Promise.all([
      AdminNotification.find(query)
        .sort({ createdAt: -1, timestamp: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AdminNotification.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: notifications,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getUnreadCount = async (req, res) => {
  try {
    const userId = String(req.user?.uid || '').trim();
    const count = await AdminNotification.countDocuments({
      ...riderNotificationQuery(userId),
      isRead: false,
    });

    return res.status(200).json({ success: true, data: { count } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.markAsRead = async (req, res) => {
  try {
    const userId = String(req.user?.uid || '').trim();
    const id = String(req.params?.id || '').trim();
    const notification = await AdminNotification.findOneAndUpdate(
      {
        _id: id,
        ...riderNotificationQuery(userId),
      },
      { $set: { isRead: true } },
      { new: true },
    );

    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found.' });
    }

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    const userId = String(req.user?.uid || '').trim();
    await AdminNotification.updateMany(
      riderNotificationQuery(userId),
      { $set: { isRead: true } },
    );

    return res.status(200).json({ success: true, data: { success: true } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
