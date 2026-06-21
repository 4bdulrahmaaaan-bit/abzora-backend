const AdminActivityLog = require('../models/AdminActivityLog');
const { ensureAdmin } = require('./authController');

async function getSecurityDashboard(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;

    // Fetch recent admin actions
    const recentActivity = await AdminActivityLog.find({})
      .sort({ createdAt: -1 })
      .limit(50);

    // Aggregate actions by admin
    const adminActionCounts = await AdminActivityLog.aggregate([
      {
        $group: {
          _id: '$adminEmail',
          count: { $sum: 1 },
          lastActive: { $max: '$createdAt' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const securityEvents = recentActivity
      .filter((entry) => {
        const action = String(entry.action || '').toUpperCase();
        return (
          action.includes('LOGIN') ||
          action.includes('REVOKE') ||
          action.includes('EXPORT') ||
          action.includes('DOWNLOAD') ||
          action.includes('ROLE')
        );
      })
      .slice(0, 10)
      .map((entry, index) => {
        const action = String(entry.action || 'ADMIN_ACTION');
        const severity = action.includes('REVOKE') || action.includes('LOGIN_FAILED')
          ? 'high'
          : action.includes('EXPORT') || action.includes('ROLE')
            ? 'medium'
            : 'low';

        return {
          id: entry.logId || entry._id?.toString() || `EVT-${index + 1}`,
          type: action,
          severity,
          ip: entry.metadata?.ip || entry.ipAddress || '',
          timestamp: entry.createdAt || entry.timestampIso || new Date(),
          details: entry.message || `${action} recorded in admin activity log`,
        };
      });

    res.status(200).json({
      success: true,
      data: {
        recentActivity,
        adminActionCounts,
        securityEvents,
      }
    });

  } catch (error) {
    next(error);
  }
}

async function revokeAccess(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    
    // In a real scenario, this would invalidate the user's session or token
    const { adminEmail } = req.body;
    
    await AdminActivityLog.create({
      adminEmail: req.user?.email || 'system@abzora.com',
      action: 'REVOKE_ACCESS',
      entityType: 'AdminUser',
      entityId: adminEmail,
      notes: `Access revoked for ${adminEmail}`,
    });

    res.status(200).json({ success: true, message: `Access revoked for ${adminEmail}` });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSecurityDashboard,
  revokeAccess,
};
