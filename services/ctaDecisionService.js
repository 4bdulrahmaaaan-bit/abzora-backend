const { getExperienceConfig } = require('./adaptiveExperienceService');

async function decideCTA({
  userId = '',
  productId,
  fitConfidence,
  returnHistory,
  userType,
  productType, // kept for backward compatibility
  locationSpeed, // kept for backward compatibility
  sessionDepth,
  productFitRisk,
  sameDayAvailable,
  sessionId,
}) {
  const config = await getExperienceConfig({
    productId,
    userId,
    fitConfidence,
    returnRate: returnHistory,
    sessionDepth,
    productFitRisk,
    sameDayAvailable,
    userType,
    sessionId,
  });

  return {
    type: config.type,
    fitConfidence: config.fitConfidence,
    reason: config.reason,
    decisionId: config.decisionId,
    cta: config.cta,
    urgency: config.urgency,
    checkoutMode: config.checkoutMode,
    experiments: config.experiments,
    ml: config.ml,
    inputs: {
      ...(config.inputs || {}),
      productType: String(productType || '').trim() || undefined,
      locationSpeed: String(locationSpeed || '').trim() || undefined,
    },
  };
}

module.exports = {
  decideCTA,
};
