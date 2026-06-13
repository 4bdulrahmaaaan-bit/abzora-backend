const AdminActivityLog = require('../models/AdminActivityLog');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  return null;
}

exports.getActivityLogs = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.actorId) {
      filter.actorId = { $regex: new RegExp(req.query.actorId, 'i') };
    }
    if (req.query.targetType) {
      filter.targetType = req.query.targetType;
    }
    if (req.query.action) {
      filter.action = req.query.action;
    }
    if (req.query.startDate || req.query.endDate) {
      filter.createdAt = {};
      if (req.query.startDate) filter.createdAt.$gte = new Date(req.query.startDate);
      if (req.query.endDate) filter.createdAt.$lte = new Date(req.query.endDate);
    }

    const logs = await AdminActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalCount = await AdminActivityLog.countDocuments(filter);

    return res.status(200).json({
      success: true,
      data: logs,
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching activity logs:', error);
    return res.status(500).json({ success: false, message: 'Failed to fetch activity logs' });
  }
};
