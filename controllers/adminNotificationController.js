const AdminNotification = require('../models/AdminNotification');
const AdminActivityLog = require('../models/AdminActivityLog');
const NotificationService = require('../services/NotificationService');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  return null;
}

async function logNotificationAction(req, action, targetId, message) {
  try {
    await AdminActivityLog.create({
      logId: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      actorId: String(req.user?.uid || 'system').trim(),
      actorRole: String(req.user?.role || 'admin').trim(),
      action,
      targetType: 'Notification',
      targetId: String(targetId),
      message,
      timestampIso: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to log notification action:', error);
  }
}

exports.sendNotification = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const { title, body, audienceRole, channels = ['Push'], campaignType = 'Instant' } = req.body;
    
    if (!title || !body || !audienceRole) {
      return res.status(400).json({ success: false, message: 'Title, body, and audienceRole are required.' });
    }

    // Mock Dispatch
    const analytics = await NotificationService.dispatch({
      title,
      body,
      audienceRole,
      channels,
      campaignType,
    });

    const notificationId = `notif-${Date.now()}`;
    const notification = await AdminNotification.create({
      notificationId,
      title,
      body,
      audienceRole,
      channels,
      campaignType,
      analytics,
      timestamp: new Date().toISOString(),
    });

    await logNotificationAction(req, 'SEND_NOTIFICATION_CAMPAIGN', notificationId, `Sent ${campaignType} campaign "${title}" to ${audienceRole} via ${channels.join(', ')}`);

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.scheduleNotification = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const { title, body, audienceRole, channels = ['Push'], scheduledAt } = req.body;

    if (!title || !body || !audienceRole || !scheduledAt) {
      return res.status(400).json({ success: false, message: 'Title, body, audienceRole, and scheduledAt are required.' });
    }

    const notificationId = `notif-sch-${Date.now()}`;
    const notification = await AdminNotification.create({
      notificationId,
      title,
      body,
      audienceRole,
      channels,
      campaignType: 'Scheduled',
      timestamp: scheduledAt,
    });

    await logNotificationAction(req, 'SCHEDULE_NOTIFICATION_CAMPAIGN', notificationId, `Scheduled campaign "${title}" for ${scheduledAt}`);

    return res.status(200).json({ success: true, data: notification });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getNotificationHistory = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const items = await AdminNotification.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await AdminNotification.countDocuments();

    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getNotificationTemplates = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  // Mocked Templates
  const templates = [
    { id: 't1', name: 'Welcome Offer', title: 'Welcome to ABZORA!', body: 'Use code WELCOME20 for 20% off your first order.', channels: ['Push', 'Email'] },
    { id: 't2', name: 'Rider Incentive', title: 'Weekend Bonus!', body: 'Complete 10 deliveries this weekend and earn an extra ₹500.', channels: ['Push', 'SMS'] },
    { id: 't3', name: 'Vendor Policy Update', title: 'New Return Policy', body: 'Please review the updated return policies effective next week.', channels: ['Email'] },
  ];

  return res.status(200).json({ success: true, data: templates });
};
