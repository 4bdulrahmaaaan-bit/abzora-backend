const AdminPlatformSettings = require('../models/AdminPlatformSettings');

function serializeLegalVersions(settings) {
  return {
    customer: String(settings?.legalPolicyVersions?.customer || 'v1.0.0'),
    vendor: String(settings?.legalPolicyVersions?.vendor || 'v1.0.0'),
    rider: String(settings?.legalPolicyVersions?.rider || 'v1.0.0'),
  };
}

async function getOrCreateSettings() {
  let settings = await AdminPlatformSettings.findOne({ key: 'platform-settings' });
  if (!settings) {
    settings = await AdminPlatformSettings.create({ key: 'platform-settings' });
  }
  return settings;
}

async function getLegalVersions(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    return res.status(200).json({
      success: true,
      data: serializeLegalVersions(settings),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getLegalVersions,
};

