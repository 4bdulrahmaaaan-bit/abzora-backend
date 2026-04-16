const { decideCTA } = require('../services/ctaDecisionService');

async function getCtaDecision(req, res, next) {
  try {
    const productId = String(req.params?.productId || '').trim();
    if (!productId) {
      return res.status(400).json({ success: false, message: 'productId is required.' });
    }

    const decision = await decideCTA({
      userId: String(req.query?.userId || '').trim(),
      productId,
      fitConfidence: req.query?.fitConfidence,
      returnHistory: req.query?.returnHistory ?? req.query?.returnRate,
      userType: req.query?.userType,
      productType: req.query?.productType,
      locationSpeed: req.query?.locationSpeed,
      sessionDepth: req.query?.sessionDepth,
      productFitRisk: req.query?.productFitRisk,
      sameDayAvailable: req.query?.sameDayAvailable,
      sessionId: req.query?.sessionId,
    });

    return res.status(200).json({
      success: true,
      data: decision,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getCtaDecision,
};
