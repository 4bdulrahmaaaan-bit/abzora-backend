const AdminPlatformSettings = require('../models/AdminPlatformSettings');
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

async function logConfigChange(req, previousState, newState) {
  try {
    await AdminActivityLog.create({
      logId: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      actorId: String(req.user?.uid || 'system').trim(),
      actorRole: String(req.user?.role || 'admin').trim(),
      action: 'UPDATE_PLATFORM_CONFIG',
      targetType: 'AdminPlatformSettings',
      targetId: 'global',
      message: 'Updated platform configuration settings',
      previousState,
      newState,
      timestampIso: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to log config change:', error);
  }
}

exports.getConfig = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    let config = await AdminPlatformSettings.findOne({ key: 'platform-settings' }).lean();
    if (!config) {
      config = await AdminPlatformSettings.create({ key: 'platform-settings' });
    }
    return res.status(200).json({ success: true, data: config });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateConfig = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    let config = await AdminPlatformSettings.findOne({ key: 'platform-settings' }).lean();
    if (!config) {
      config = await AdminPlatformSettings.create({ key: 'platform-settings' });
    }

    const updates = { ...req.body };
    delete updates._id;
    delete updates.key;
    delete updates.createdAt;
    delete updates.updatedAt;
    delete updates.__v;

    const newConfig = await AdminPlatformSettings.findOneAndUpdate(
      { key: 'platform-settings' },
      { $set: updates },
      { new: true }
    ).lean();

    await logConfigChange(req, config, newConfig);

    return res.status(200).json({ success: true, data: newConfig });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getConfigHistory = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const query = { action: 'UPDATE_PLATFORM_CONFIG', targetType: 'AdminPlatformSettings' };
    const history = await AdminActivityLog.find(query)
      .sort({ timestampIso: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const totalCount = await AdminActivityLog.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: history,
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
