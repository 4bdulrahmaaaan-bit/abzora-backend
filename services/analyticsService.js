const AnalyticsEvent = require('../models/AnalyticsEvent');
const ExperienceLog = require('../models/ExperienceLog');
const ExperienceControl = require('../models/ExperienceControl');
const { updateReward } = require('./mlBanditService');
const cache = require('./redisCacheService');

const TRACKED_EVENTS = new Set([
  'product_view',
  'add_to_cart',
  'size_selected',
  'ar_try_used',
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

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function redisLiveKey(productId) {
  return `product:${productId}:live`;
}

async function updateLiveMetrics({
  eventType,
  productId,
  timestamp,
  priceShown = 0,
  discountShown = 0,
}) {
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId) {
    return null;
  }

  const key = redisLiveKey(normalizedProductId);
  const previous = (await cache.getJson(key)) || {};
  const next = {
    views: Number(previous.views || 0),
    carts: Number(previous.carts || 0),
    purchases: Number(previous.purchases || 0),
    viewers: Number(previous.viewers || 0),
    lastEventAt: timestamp || new Date().toISOString(),
    lastPriceShown: normalizeNumber(priceShown, Number(previous.lastPriceShown || 0)),
    lastDiscountShown: normalizeNumber(
      discountShown,
      Number(previous.lastDiscountShown || 0),
    ),
  };

  if (eventType === 'product_view') {
    next.views += 1;
    next.viewers += 1;
  }
  if (eventType === 'add_to_cart') {
    next.carts += 1;
  }
  if (eventType === 'purchase') {
    next.purchases += 1;
  }

  await cache.setJson(key, next, 60);
  return next;
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
  const metadataPriceShown = normalizeNumber(metadata?.price_shown ?? metadata?.priceShown, 0);
  const metadataDiscountShown = normalizeNumber(
    metadata?.discount_shown ?? metadata?.discountShown,
    0,
  );
  const live = await updateLiveMetrics({
    eventType: normalizedEventType,
    productId,
    timestamp: doc.timestamp?.toISOString?.() || new Date().toISOString(),
    priceShown: metadataPriceShown,
    discountShown: metadataDiscountShown,
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

  return {
    ...doc.toObject(),
    liveMetrics: live,
  };
}

function buildDateFilter({ from, to }) {
  const match = {};
  if (from || to) {
    match.timestamp = {};
    if (from) {
      const start = new Date(from);
      if (!Number.isNaN(start.getTime())) {
        match.timestamp.$gte = start;
      }
    }
    if (to) {
      const end = new Date(to);
      if (!Number.isNaN(end.getTime())) {
        match.timestamp.$lte = end;
      }
    }
    if (Object.keys(match.timestamp).length === 0) {
      delete match.timestamp;
    }
  }
  return match;
}

async function getProductAnalyticsSummary(productId, { from, to } = {}) {
  const match = {
    productId: String(productId || '').trim(),
    ...buildDateFilter({ from, to }),
  };
  const [summary] = await AnalyticsEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$productId',
        views: {
          $sum: { $cond: [{ $eq: ['$eventType', 'product_view'] }, 1, 0] },
        },
        carts: {
          $sum: { $cond: [{ $eq: ['$eventType', 'add_to_cart'] }, 1, 0] },
        },
        purchases: {
          $sum: { $cond: [{ $eq: ['$eventType', 'purchase'] }, 1, 0] },
        },
        arTryUsed: {
          $sum: { $cond: [{ $eq: ['$eventType', 'ar_try_used'] }, 1, 0] },
        },
      },
    },
  ]);
  const views = Number(summary?.views || 0);
  const purchases = Number(summary?.purchases || 0);
  const carts = Number(summary?.carts || 0);
  return {
    product_id: String(productId || ''),
    views,
    carts,
    purchases,
    cart_rate: views > 0 ? Number(((carts / views) * 100).toFixed(2)) : 0,
    conversion_rate:
      views > 0 ? Number(((purchases / views) * 100).toFixed(2)) : 0,
    ar_try_used: Number(summary?.arTryUsed || 0),
  };
}

async function getPriceConversionChart(productId, { from, to } = {}) {
  const match = {
    productId: String(productId || '').trim(),
    ...buildDateFilter({ from, to }),
    'metadata.price_shown': { $exists: true },
  };
  return AnalyticsEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $round: ['$metadata.price_shown', 0] },
        views: {
          $sum: { $cond: [{ $eq: ['$eventType', 'product_view'] }, 1, 0] },
        },
        purchases: {
          $sum: { $cond: [{ $eq: ['$eventType', 'purchase'] }, 1, 0] },
        },
      },
    },
    { $sort: { '_id': 1 } },
    {
      $project: {
        _id: 0,
        price: '$_id',
        conversion_rate: {
          $cond: [{ $gt: ['$views', 0] }, { $multiply: [{ $divide: ['$purchases', '$views'] }, 100] }, 0],
        },
      },
    },
  ]);
}

async function getDiscountSalesChart(productId, { from, to } = {}) {
  const match = {
    productId: String(productId || '').trim(),
    ...buildDateFilter({ from, to }),
    'metadata.discount_shown': { $exists: true },
  };
  return AnalyticsEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $round: ['$metadata.discount_shown', 0] },
        sales: {
          $sum: { $cond: [{ $eq: ['$eventType', 'purchase'] }, 1, 0] },
        },
      },
    },
    { $sort: { '_id': 1 } },
    { $project: { _id: 0, discount: '$_id', sales: 1 } },
  ]);
}

async function getTimeSeriesChart(productId, { from, to } = {}) {
  const match = {
    productId: String(productId || '').trim(),
    ...buildDateFilter({ from, to }),
  };
  return AnalyticsEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: { format: '%Y-%m-%dT%H:00:00.000Z', date: '$timestamp' },
        },
        views: {
          $sum: { $cond: [{ $eq: ['$eventType', 'product_view'] }, 1, 0] },
        },
        purchases: {
          $sum: { $cond: [{ $eq: ['$eventType', 'purchase'] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        timestamp: '$_id',
        views: 1,
        purchases: 1,
      },
    },
  ]);
}

async function getAnalyticsSummary({ from, to } = {}) {
  const match = buildDateFilter({ from, to });
  const [summary] = await AnalyticsEvent.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        views: {
          $sum: { $cond: [{ $eq: ['$eventType', 'product_view'] }, 1, 0] },
        },
        carts: {
          $sum: { $cond: [{ $eq: ['$eventType', 'add_to_cart'] }, 1, 0] },
        },
        purchases: {
          $sum: { $cond: [{ $eq: ['$eventType', 'purchase'] }, 1, 0] },
        },
      },
    },
  ]);
  const views = Number(summary?.views || 0);
  const carts = Number(summary?.carts || 0);
  const purchases = Number(summary?.purchases || 0);
  return {
    views,
    cart_rate: views > 0 ? Number(((carts / views) * 100).toFixed(2)) : 0,
    conversion_rate:
      views > 0 ? Number(((purchases / views) * 100).toFixed(2)) : 0,
    purchases,
  };
}

module.exports = {
  TRACKED_EVENTS,
  trackEvent,
  getProductAnalyticsSummary,
  getPriceConversionChart,
  getDiscountSalesChart,
  getTimeSeriesChart,
  getAnalyticsSummary,
};
