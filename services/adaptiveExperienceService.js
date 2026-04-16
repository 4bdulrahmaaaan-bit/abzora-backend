const crypto = require('crypto');

const ExperienceControl = require('../models/ExperienceControl');
const ExperienceLog = require('../models/ExperienceLog');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { assignUserVariants } = require('./abTestingService');
const { decideAction } = require('./mlBanditService');

function normalizeUserId(userId) {
  return String(userId || '').trim();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBoolean(input, fallback = false) {
  if (typeof input === 'boolean') {
    return input;
  }
  const text = String(input || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(text)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(text)) {
    return false;
  }
  return fallback;
}

function normalizeString(input, fallback = '') {
  const text = String(input || '').trim();
  return text || fallback;
}

function buildDecisionId({ userId, productId }) {
  const seed = `${userId || 'guest'}:${productId}:${Date.now()}:${Math.random()}`;
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 20);
}

async function getExperienceControl() {
  const existing = await ExperienceControl.findOne({ key: 'default' }).lean();
  if (existing) {
    return existing;
  }
  const created = await ExperienceControl.create({ key: 'default' });
  return created.toObject();
}

async function resolveUserAndBehavior(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) {
    return {
      user: null,
      userType: 'new',
      returnRate: 0,
      orderCount: 0,
      deliveredCount: 0,
    };
  }

  const [user, deliveredCount, returnedCount, orderCount] = await Promise.all([
    User.findOne({ uid: normalizedUserId }).select('uid city userTrialScore').lean(),
    Order.countDocuments({ userId: normalizedUserId, orderStatus: 'delivered' }),
    Order.countDocuments({
      userId: normalizedUserId,
      returnStatus: { $in: ['requested', 'approved', 'assigned', 'picked', 'completed'] },
    }),
    Order.countDocuments({ userId: normalizedUserId }),
  ]);

  return {
    user,
    userType: deliveredCount > 0 ? 'repeat' : 'new',
    returnRate: deliveredCount > 0 ? (returnedCount / deliveredCount) * 100 : 0,
    orderCount,
    deliveredCount,
  };
}

function computeRuleDecision({
  fitConfidence,
  returnRate,
  productFitRisk,
  sameDayAvailable,
  sessionDepth,
  thresholds,
  toggles,
}) {
  const highFit = fitConfidence >= thresholds.highFitConfidence;
  const lowFit = fitConfidence <= thresholds.lowFitConfidence;
  const highReturn = returnRate >= thresholds.highReturnRate;
  const highRisk = productFitRisk >= thresholds.highFitRisk;

  let cta = 'HYBRID';
  let urgency = 'SOFT';
  let checkoutMode = 'STANDARD';
  let reason = 'Balanced confidence profile.';

  if (highFit && sameDayAvailable) {
    cta = 'BUY_NOW';
    urgency = 'HIGH';
    checkoutMode = 'INSTANT';
    reason = 'High fit confidence with same-day fulfillment.';
  } else if (lowFit || highReturn || highRisk) {
    cta = 'TRY_HOME';
    urgency = 'SOFT';
    checkoutMode = 'STANDARD';
    reason = 'Low fit confidence or high return risk detected.';
  } else if (sessionDepth >= 5 && sameDayAvailable) {
    cta = 'BUY_NOW';
    urgency = 'SOFT';
    checkoutMode = 'INSTANT';
    reason = 'High engagement detected in session.';
  }

  if (!toggles.urgencyEnabled) {
    urgency = 'NONE';
  }

  return {
    cta,
    urgency,
    checkoutMode,
    reason,
  };
}

function mapLegacyType(cta) {
  if (cta === 'BUY_NOW') return 'BUY_NOW_PRIORITY';
  if (cta === 'TRY_HOME') return 'TRY_AT_HOME_PRIORITY';
  return 'HYBRID';
}

function applyExperimentOverrides(baseDecision, assignments = {}) {
  const result = { ...baseDecision };
  if (['BUY_NOW', 'TRY_HOME', 'HYBRID'].includes(assignments.cta)) {
    result.cta = assignments.cta;
    result.source = 'AB_TEST';
  }
  if (['NONE', 'SOFT', 'HIGH'].includes(assignments.urgency)) {
    result.urgency = assignments.urgency;
  }
  if (['INSTANT', 'STANDARD'].includes(assignments.checkoutMode)) {
    result.checkoutMode = assignments.checkoutMode;
  }
  return result;
}

async function getExperienceConfig({
  productId,
  userId = '',
  fitConfidence: fitConfidenceInput,
  returnRate: returnRateInput,
  sessionDepth: sessionDepthInput,
  productFitRisk: productFitRiskInput,
  sameDayAvailable: sameDayInput,
  userType: userTypeInput,
  sessionId = '',
}) {
  const product = await Product.findById(productId).select('fitRisk sameDayEligible category').lean();
  if (!product) {
    throw new Error('Product not found for experience config.');
  }

  const control = await getExperienceControl();
  const thresholds = control.thresholds || {};
  const toggles = control.toggles || {};

  const behavior = await resolveUserAndBehavior(userId);
  const userType = normalizeString(userTypeInput, behavior.userType || 'new').toLowerCase() === 'repeat'
    ? 'repeat'
    : 'new';
  const fitBase = Number.isFinite(Number(fitConfidenceInput))
    ? Number(fitConfidenceInput)
    : Number(behavior.user?.userTrialScore ?? 60);
  const fitConfidence = clamp(Math.round(fitBase), 0, 100);
  const returnRate = Number.isFinite(Number(returnRateInput))
    ? clamp(Number(returnRateInput), 0, 100)
    : clamp(Number(behavior.returnRate) || 0, 0, 100);
  const sessionDepth = clamp(Number(sessionDepthInput) || 1, 1, 20);
  const productFitRisk = clamp(
    Number.isFinite(Number(productFitRiskInput)) ? Number(productFitRiskInput) : Number(product.fitRisk || 0.35),
    0,
    1,
  );
  const sameDayAvailable = normalizeBoolean(
    sameDayInput,
    Boolean(product.sameDayEligible) && Boolean(behavior.user?.city || true),
  );

  const ruleDecision = computeRuleDecision({
    fitConfidence,
    returnRate,
    productFitRisk,
    sameDayAvailable,
    sessionDepth,
    thresholds,
    toggles,
  });

  let assignments = {};
  if (toggles.abTestingEnabled && userId) {
    assignments = await assignUserVariants({ userId: normalizeUserId(userId) });
  }

  let decision = {
    ...ruleDecision,
    source: 'RULE',
  };
  decision = applyExperimentOverrides(decision, assignments);

  let mlDecision = null;
  if (toggles.mlEnabled) {
    const ml = await decideAction({
      features: {
        fitConfidence,
        returnRate,
        sessionDepth,
        sameDayAvailable,
        productFitRisk,
        userType,
      },
      epsilon: control.ml?.epsilon,
      seed: `${userId}:${productId}:${sessionDepth}`,
      preferredAction: toggles.abTestingEnabled ? decision.cta : '',
    });
    mlDecision = ml;

    if (!toggles.abTestingEnabled) {
      decision.cta = ml.action;
      decision.source = 'ML_BANDIT';
    }
  }

  const decisionId = buildDecisionId({ userId, productId });
  await ExperienceLog.create({
    decisionId,
    userId: normalizeUserId(userId),
    productId: String(productId),
    sessionId: String(sessionId || '').trim(),
    cta: decision.cta,
    urgency: decision.urgency,
    checkoutMode: decision.checkoutMode,
    source: decision.source,
    features: {
      fitConfidence,
      returnRate,
      sessionDepth,
      productFitRisk,
      sameDayAvailable,
      userType,
    },
    abAssignments: assignments,
    mlDecision: mlDecision || {},
    decisionAt: new Date(),
  });

  return {
    decisionId,
    cta: decision.cta,
    urgency: decision.urgency,
    checkoutMode: decision.checkoutMode,
    type: mapLegacyType(decision.cta),
    fitConfidence,
    reason: ruleDecision.reason,
    experiments: assignments,
    presentation: {
      login: assignments.login || 'DELAYED',
      tryAtHomePlacement: assignments.tryAtHomePlacement || 'SECONDARY',
      socialProof: assignments.socialProof || 'GLOBAL',
      priceContext: assignments.priceContext || 'PLAIN',
    },
    ml: mlDecision
      ? {
          action: mlDecision.action,
          exploration: mlDecision.exploration,
          scores: mlDecision.scores,
        }
      : null,
    inputs: {
      fitConfidence,
      returnRate,
      sessionDepth,
      productFitRisk,
      sameDayAvailable,
      userType,
    },
    control: {
      thresholds,
      toggles,
    },
  };
}

async function updateExperienceControl({
  thresholds,
  toggles,
  ml,
  updatedBy = 'system',
}) {
  const update = {};
  if (thresholds && typeof thresholds === 'object') {
    for (const key of ['highFitConfidence', 'lowFitConfidence', 'highReturnRate', 'highFitRisk']) {
      if (thresholds[key] !== undefined) {
        update[`thresholds.${key}`] = Number(thresholds[key]);
      }
    }
  }
  if (toggles && typeof toggles === 'object') {
    for (const key of ['ruleEngineEnabled', 'urgencyEnabled', 'mlEnabled', 'abTestingEnabled']) {
      if (toggles[key] !== undefined) {
        update[`toggles.${key}`] = Boolean(toggles[key]);
      }
    }
  }
  if (ml && typeof ml === 'object') {
    if (ml.epsilon !== undefined) {
      update['ml.epsilon'] = Number(ml.epsilon);
    }
    if (ml.learningRate !== undefined) {
      update['ml.learningRate'] = Number(ml.learningRate);
    }
  }
  update.updatedBy = String(updatedBy || 'system').trim() || 'system';

  const doc = await ExperienceControl.findOneAndUpdate(
    { key: 'default' },
    { $set: update, $setOnInsert: { key: 'default' } },
    { upsert: true, new: true },
  ).lean();
  return doc;
}

module.exports = {
  getExperienceConfig,
  getExperienceControl,
  updateExperienceControl,
};
