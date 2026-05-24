const { getGarmentQualityPolicy } = require('./arGarmentQualityPolicyService');

const TIER_KEYS = ['low', 'mid', 'flagship', 'premium_lidar'];

function isValidHttpsUrl(value) {
  const raw = value?.toString().trim() || '';
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function guessTriangleEstimateFromUrl(modelUrl) {
  const raw = modelUrl?.toString().toLowerCase() || '';
  if (!raw) return 100000;
  if (raw.includes('lod2')) return 12000;
  if (raw.includes('lod1')) return 24000;
  if (raw.includes('lod0')) return 48000;
  return 36000;
}

async function readContentLength(url) {
  if (!isValidHttpsUrl(url)) return 0;
  try {
    const response = await fetch(url, { method: 'HEAD' });
    if (!response.ok) return 0;
    const len = Number(response.headers.get('content-length') || 0);
    return Number.isFinite(len) ? len : 0;
  } catch (_) {
    return 0;
  }
}

async function validateGarmentProduct(product) {
  const policy = getGarmentQualityPolicy();
  const modelUrl = product.model3d || product.garmentConfig?.templateId?.modelUrls?.lod0 || '';
  const textureUrl = product.garmentConfig?.fabricTextureUrl || product.garmentConfig?.templateId?.defaultFabricTextureUrl || '';
  const findings = [];
  let score = 1;

  if (!isValidHttpsUrl(modelUrl)) {
    findings.push({ code: 'INVALID_MODEL_URL', reason: 'Model URL missing or not HTTPS.' });
    score -= 0.5;
  }
  if (textureUrl && !isValidHttpsUrl(textureUrl)) {
    findings.push({ code: 'INVALID_TEXTURE_URL', reason: 'Texture URL is not HTTPS.' });
    score -= 0.2;
  }

  const [modelBytes, textureBytes] = await Promise.all([
    readContentLength(modelUrl),
    readContentLength(textureUrl),
  ]);
  const triangleEstimate = guessTriangleEstimateFromUrl(modelUrl);

  const tierBudgets = TIER_KEYS.map((tier) => {
    const modelBudget = Number(policy.maxModelBytesByTier[tier] || 0);
    const textureBudget = Number(policy.maxTextureBytesByTier[tier] || 0);
    const triangleBudget = Number(policy.maxTriangleEstimateByTier[tier] || 0);
    const passesModel = !modelBytes || modelBytes <= modelBudget;
    const passesTexture = !textureBytes || textureBytes <= textureBudget;
    const passesTriangles = triangleEstimate <= triangleBudget;
    return {
      tier: tier.toUpperCase(),
      passes: passesModel && passesTexture && passesTriangles,
      modelBytes,
      modelBudget,
      textureBytes,
      textureBudget,
      triangleEstimate,
      triangleBudget,
    };
  });

  if (!tierBudgets.some((item) => item.passes)) {
    findings.push({
      code: 'BUDGET_EXCEEDED',
      reason: 'Model/texture/triangle estimates exceed all tier budgets.',
    });
    score -= 0.45;
  }
  if (!Array.isArray(product.images) || product.images.length === 0) {
    findings.push({ code: 'MISSING_PREVIEW', reason: 'Preview image missing.' });
    score -= 0.2;
  }

  const qualityScore = Math.max(0, Number(score.toFixed(4)));
  const certified = qualityScore >= Number(policy.minQualityScore || 0.7);
  return {
    certified,
    qualityScore,
    findings,
    modelUrl,
    textureUrl,
    modelBytes,
    textureBytes,
    triangleEstimate,
    tierBudgets,
  };
}

module.exports = {
  validateGarmentProduct,
};
