const adminBusinessAnalyticsService = require('../services/adminBusinessAnalyticsService');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  return null;
}

exports.getBusinessAnalyticsV2 = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const [overview, trends, geographic, topVendors] = await Promise.all([
      adminBusinessAnalyticsService.getOverviewMetrics(),
      adminBusinessAnalyticsService.getRevenueTrends(),
      adminBusinessAnalyticsService.getGeographicDistribution(),
      adminBusinessAnalyticsService.getTopVendors(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        overview,
        trends,
        geographic,
        topVendors,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
