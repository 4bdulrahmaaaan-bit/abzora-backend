const adminRiderAnalyticsService = require('../services/adminRiderAnalyticsService');
const AdminActivityLog = require('../models/AdminActivityLog');
const User = require('../models/User');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  return null;
}

exports.getDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const kpis = await adminRiderAnalyticsService.getDashboardKPIs();
    return res.status(200).json({ success: true, data: kpis });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRidersList = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const classification = req.query.classification; // Optional filter
    const riders = await adminRiderAnalyticsService.getClassifiedRiders(classification);
    
    // Pagination is handled after classification enrichment.
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const paginatedRiders = riders.slice(skip, skip + limit);

    return res.status(200).json({
      success: true,
      data: paginatedRiders,
      meta: {
        page,
        limit,
        totalCount: riders.length,
        totalPages: Math.ceil(riders.length / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PATCH /admin/riders/:uid/suspend
 * Suspend or reinstate a rider with mandatory audit log entry.
 */
exports.setSuspendRider = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const { suspend, reason } = req.body;
    const rider = await User.findOneAndUpdate(
      { uid: req.params.uid },
      { isActive: !suspend, updatedAt: new Date() },
      { new: true },
    ).lean();

    if (!rider) return res.status(404).json({ success: false, message: 'Rider not found' });

    await AdminActivityLog.create({
      adminId: req.user?.uid || req.dbUser?._id?.toString() || 'system',
      adminEmail: req.user?.email || req.dbUser?.email || '',
      action: suspend ? 'suspend_rider' : 'reinstate_rider',
      target: `rider:${rider.uid}`,
      details: { riderName: rider.name, reason: reason || '' },
      timestamp: new Date(),
    });

    return res.status(200).json({ success: true, data: { uid: rider.uid, isActive: rider.isActive } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
