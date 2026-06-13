const adminFinanceAnalyticsService = require('../services/adminFinanceAnalyticsService');
const Settlement = require('../models/Settlement');
const RefundRequest = require('../models/RefundRequest');
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

exports.getDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const kpis = await adminFinanceAnalyticsService.getDashboardKPIs();
    return res.status(200).json({ success: true, data: kpis });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getSettlements = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.type) filter.settlementType = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const items = await Settlement.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const totalCount = await Settlement.countDocuments(filter);

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

exports.getRefunds = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const items = await RefundRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const totalCount = await RefundRequest.countDocuments(filter);

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

exports.getReports = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const period = req.query.period || 'Daily';
    const reports = await adminFinanceAnalyticsService.getReports(period);
    return res.status(200).json({ success: true, data: reports });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /admin/finance/settlements/:id/process
 * Process a pending settlement with mandatory audit log.
 */
exports.processSettlement = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const settlement = await Settlement.findByIdAndUpdate(
      req.params.id,
      { status: 'Processed', processedAt: new Date() },
      { new: true },
    ).lean();

    if (!settlement) return res.status(404).json({ success: false, message: 'Settlement not found' });

    await AdminActivityLog.create({
      adminId: req.user?.uid || req.dbUser?._id?.toString() || 'system',
      adminEmail: req.user?.email || req.dbUser?.email || '',
      action: 'process_settlement',
      target: `settlement:${settlement._id}`,
      details: { amount: settlement.amount, type: settlement.settlementType },
      timestamp: new Date(),
    });

    return res.status(200).json({ success: true, data: settlement });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /admin/finance/refunds/:id/approve
 * Approve a refund request with mandatory audit log.
 */
exports.approveRefund = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const refund = await RefundRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date() },
      { new: true },
    ).lean();

    if (!refund) return res.status(404).json({ success: false, message: 'Refund request not found' });

    await AdminActivityLog.create({
      adminId: req.user?.uid || req.dbUser?._id?.toString() || 'system',
      adminEmail: req.user?.email || req.dbUser?.email || '',
      action: 'approve_refund',
      target: `refund:${refund._id}`,
      details: { amount: refund.amount, reason: refund.reason || '' },
      timestamp: new Date(),
    });

    return res.status(200).json({ success: true, data: refund });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
