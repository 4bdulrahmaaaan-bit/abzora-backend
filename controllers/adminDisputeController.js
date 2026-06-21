const AdminDispute = require('../models/AdminDispute');
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

async function logDisputeAction(req, action, disputeId, previousState, newState, message) {
  try {
    await AdminActivityLog.create({
      logId: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      actorId: String(req.user?.uid || 'system').trim(),
      actorRole: String(req.user?.role || 'admin').trim(),
      action,
      targetType: 'Dispute',
      targetId: String(disputeId),
      message,
      previousState,
      newState,
      timestampIso: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to log dispute action:', error);
  }
}

exports.getDisputesDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [openDisputes, escalatedCases, resolvedTodayList] = await Promise.all([
      AdminDispute.countDocuments({ status: { $in: ['Open', 'Investigating'] } }),
      AdminDispute.countDocuments({ status: 'Escalated' }),
      AdminDispute.find({
        status: 'Resolved',
        updatedAt: { $gte: today },
      }).select('_id'),
    ]);

    const resolvedDisputes = await AdminDispute.find({
      status: 'Resolved',
    }).select('createdAt updatedAt').lean();
    const totalResolutionHours = resolvedDisputes.reduce((sum, dispute) => {
      const createdAt = dispute.createdAt ? new Date(dispute.createdAt).getTime() : 0;
      const updatedAt = dispute.updatedAt ? new Date(dispute.updatedAt).getTime() : 0;
      if (!createdAt || !updatedAt || updatedAt < createdAt) return sum;
      return sum + ((updatedAt - createdAt) / (60 * 60 * 1000));
    }, 0);
    const avgResolutionTimeHours = resolvedDisputes.length > 0
      ? Math.round((totalResolutionHours / resolvedDisputes.length) * 10) / 10
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        openDisputes,
        escalatedCases,
        resolvedToday: resolvedTodayList.length,
        avgResolutionTime: `${avgResolutionTimeHours}h`,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listDisputes = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.priority) filter.priority = req.query.priority;

    const items = await AdminDispute.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalCount = await AdminDispute.countDocuments(filter);

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

exports.getDispute = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const item = await AdminDispute.findOne({ disputeId: req.params.id });
    if (!item) return res.status(404).json({ success: false, message: 'Dispute not found' });
    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateDispute = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const disputeId = String(req.params.id || '').trim();
    if (!disputeId) return res.status(400).json({ success: false, message: 'Dispute id is required.' });

    const previousState = await AdminDispute.findOne({ disputeId }).lean();
    
    const updates = { ...req.body };
    delete updates._id;
    delete updates.disputeId;

    const item = await AdminDispute.findOneAndUpdate(
      { disputeId },
      { $set: updates },
      { new: true }
    ).lean();

    if (item) {
      await logDisputeAction(req, 'UPDATE_DISPUTE', disputeId, previousState, item, `Dispute ${disputeId} updated`);
    }

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.escalateDispute = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const disputeId = String(req.params.id || '').trim();
    if (!disputeId) return res.status(400).json({ success: false, message: 'Dispute id is required.' });

    const previousState = await AdminDispute.findOne({ disputeId }).lean();
    if (!previousState) return res.status(404).json({ success: false, message: 'Dispute not found' });

    const note = req.body.note || 'Escalated by admin';
    
    const item = await AdminDispute.findOneAndUpdate(
      { disputeId },
      { 
        $set: { status: 'Escalated', priority: 'Critical' },
        $push: { 
          timeline: { action: 'Escalated', note, timestamp: new Date().toISOString(), actor: req.user?.uid || 'system' },
          notes: { text: note, author: req.user?.uid || 'system', timestamp: new Date().toISOString() }
        }
      },
      { new: true }
    ).lean();

    await logDisputeAction(req, 'ESCALATE_DISPUTE', disputeId, previousState, item, `Dispute ${disputeId} escalated: ${note}`);

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.resolveDispute = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const disputeId = String(req.params.id || '').trim();
    if (!disputeId) return res.status(400).json({ success: false, message: 'Dispute id is required.' });

    const previousState = await AdminDispute.findOne({ disputeId }).lean();
    if (!previousState) return res.status(404).json({ success: false, message: 'Dispute not found' });

    const resolutionDetails = req.body.resolutionDetails || 'Resolved by admin';
    
    const item = await AdminDispute.findOneAndUpdate(
      { disputeId },
      { 
        $set: { status: 'Resolved' },
        $push: { 
          timeline: { action: 'Resolved', note: resolutionDetails, timestamp: new Date().toISOString(), actor: req.user?.uid || 'system' },
          resolutionHistory: { resolutionDetails, timestamp: new Date().toISOString(), resolvedBy: req.user?.uid || 'system' }
        }
      },
      { new: true }
    ).lean();

    await logDisputeAction(req, 'RESOLVE_DISPUTE', disputeId, previousState, item, `Dispute ${disputeId} resolved`);

    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
