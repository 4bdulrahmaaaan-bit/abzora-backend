const {
  getExperienceConfig,
  getExperienceControl,
  updateExperienceControl,
} = require('../services/adaptiveExperienceService');

function getAuthenticatedUserId(req) {
  return req.user?.uid || req.user?.firebaseUid || req.user?.id || '';
}

async function fetchExperienceConfig(req, res, next) {
  try {
    const productId = String(req.params?.productId || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, message: 'productId is required.' });
    }

    const payload = await getExperienceConfig({
      productId,
      userId: getAuthenticatedUserId(req),
      fitConfidence: req.query?.fitConfidence,
      returnRate: req.query?.returnRate ?? req.query?.returnHistory,
      sessionDepth: req.query?.sessionDepth,
      productFitRisk: req.query?.productFitRisk,
      sameDayAvailable: req.query?.sameDayAvailable,
      userType: req.query?.userType,
      sessionId: req.query?.sessionId,
    });

    return res.status(200).json({ success: true, data: payload });
  } catch (error) {
    return next(error);
  }
}

async function fetchExperienceControl(req, res, next) {
  try {
    const control = await getExperienceControl();
    return res.status(200).json({ success: true, data: control });
  } catch (error) {
    return next(error);
  }
}

async function saveExperienceControl(req, res, next) {
  try {
    const payload = await updateExperienceControl({
      thresholds: req.body?.thresholds,
      toggles: req.body?.toggles,
      ml: req.body?.ml,
      updatedBy: getAuthenticatedUserId(req) || 'system',
    });
    return res.status(200).json({ success: true, data: payload });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  fetchExperienceConfig,
  fetchExperienceControl,
  saveExperienceControl,
};
