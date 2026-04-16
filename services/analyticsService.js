const AnalyticsEvent = require('../models/AnalyticsEvent');
const ExperienceLog = require('../models/ExperienceLog');
const ExperienceControl = require('../models/ExperienceControl');
const { updateReward } = require('./mlBanditService');

const TRACKED_EVENTS = new Set([
  'product_view',
  'cta_shown',
  'cta_click',
  'checkout_start',
  'purchase',
  'trial_request',
  'trial_conversion',
]);

function normalizeEventType(eventType) {
  return String(eventType || '').trim().toLowerCase();
}

async function trackEvent({
  eventType,
  userId = '',
  sessionId = '',
  productId = '',
  decisionId = '',
  cta = '',
  metadata = {},
  timestamp = null,
}) {
  const normalizedEventType = normalizeEventType(eventType);
  if (!TRACKED_EVENTS.has(normalizedEventType)) {
    throw new Error(`Unsupported analytics event: ${eventType}`);
  }

  const doc = await AnalyticsEvent.create({
    eventType: normalizedEventType,
    userId: String(userId || '').trim(),
    sessionId: String(sessionId || '').trim(),
    productId: String(productId || '').trim(),
    decisionId: String(decisionId || '').trim(),
    cta: String(cta || '').trim().toUpperCase(),
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
    timestamp: timestamp ? new Date(timestamp) : new Date(),
  });

  const updates = {};
  if (normalizedEventType === 'purchase') {
    updates['result.purchased'] = true;
    updates['result.reward'] = 1;
  } else if (normalizedEventType === 'trial_request') {
    updates['result.trialRequested'] = true;
  } else if (normalizedEventType === 'trial_conversion') {
    updates['result.trialConverted'] = true;
    updates['result.reward'] = 0.7;
  }

  if (decisionId && Object.keys(updates).length > 0) {
    await ExperienceLog.updateOne(
      { decisionId: String(decisionId).trim() },
      { $set: updates },
    );

    const log = await ExperienceLog.findOne({ decisionId: String(decisionId).trim() }).lean();
    const reward = updates['result.reward'];
    if (log && typeof reward === 'number' && log.cta) {
      const control = await ExperienceControl.findOne({ key: 'default' }).lean();
      await updateReward({
        action: log.cta,
        reward,
        features: log.features || {},
        learningRate: control?.ml?.learningRate ?? 0.08,
        exploration: Boolean(log.mlDecision?.exploration),
      });
    }
  }

  return doc.toObject();
}

module.exports = {
  TRACKED_EVENTS,
  trackEvent,
};
