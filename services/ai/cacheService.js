const crypto = require('crypto');

const SupportResponseCache = require('../../models/SupportResponseCache');

function normalizeKey(input, { chatType = '', intent = '' } = {}) {
  const normalized = `${chatType} ${intent} ${input || ''}`
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

function buildCacheKey(input, options = {}) {
  const normalized = normalizeKey(input, options);
  const hash = crypto.createHash('sha256').update(normalized).digest('hex');
  return {
    normalized,
    hash,
    key: `${options.chatType || 'general'}:${hash}`,
  };
}

async function getCachedResponse({ userId, input, chatType = '', intent = '' }) {
  const cacheIdentity = buildCacheKey(input, { chatType, intent });
  const item = await SupportResponseCache.findOne({
    userId,
    cacheKey: cacheIdentity.key,
  });

  if (!item) {
    return null;
  }

  return {
    cacheKey: cacheIdentity.key,
    normalizedKey: cacheIdentity.normalized,
    response: item.response,
    intent: item.intent,
    updatedAt: item.updatedAtLabel || item.updatedAt?.toISOString() || '',
  };
}

async function setCachedResponse({
  userId,
  input,
  response,
  chatType = '',
  intent = 'ai_needed',
  updatedAt = new Date().toISOString(),
}) {
  const cacheIdentity = buildCacheKey(input, { chatType, intent });
  await SupportResponseCache.findOneAndUpdate(
    { userId, cacheKey: cacheIdentity.key },
    {
      userId,
      cacheKey: cacheIdentity.key,
      response,
      intent,
      updatedAtLabel: updatedAt,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return {
    cacheKey: cacheIdentity.key,
    normalizedKey: cacheIdentity.normalized,
  };
}

module.exports = {
  normalizeKey,
  buildCacheKey,
  getCachedResponse,
  setCachedResponse,
};
