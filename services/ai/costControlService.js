const UserAiUsageStat = require('../../models/UserAiUsageStat');

const DEFAULT_DAILY_TOKEN_LIMIT = 6000;
const DEFAULT_DAILY_COST_LIMIT = 0.12;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function estimateTokens(parts = []) {
  const text = parts.filter(Boolean).join(' ').trim();
  return Math.ceil(text.length / 4);
}

async function getUsageForDate(userId, dateKey = todayKey()) {
  const usage = await UserAiUsageStat.findOne({ userId });
  if (!usage || usage.dateKey !== dateKey) {
    return {
      dateKey,
      aiCallsToday: 0,
      tokensToday: 0,
      dailyCost: 0,
      blockedToday: 0,
    };
  }

  return {
    dateKey,
    aiCallsToday: Number(usage.aiCallsToday || 0),
    tokensToday: Number(usage.tokensToday || 0),
    dailyCost: Number(usage.dailyCost || 0),
    blockedToday: Number(usage.blockedToday || 0),
  };
}

async function canUseAi({ userId, estimatedTokens, dateKey = todayKey(), limitMultiplier = 1 }) {
  const usage = await getUsageForDate(userId, dateKey);
  const tokenLimit = DEFAULT_DAILY_TOKEN_LIMIT * limitMultiplier;
  const costLimit = DEFAULT_DAILY_COST_LIMIT * limitMultiplier;

  if ((usage.tokensToday + estimatedTokens) > tokenLimit) {
    return { allowed: false, reason: 'daily_token_limit_reached', usage, tokenLimit, costLimit };
  }

  if (usage.dailyCost >= costLimit) {
    return { allowed: false, reason: 'daily_cost_limit_reached', usage, tokenLimit, costLimit };
  }

  return { allowed: true, reason: null, usage, tokenLimit, costLimit };
}

async function recordUsage({
  userId,
  dateKey = todayKey(),
  usedAi = false,
  tokensUsed = 0,
  cost = 0,
  blocked = false,
  timestamp = new Date().toISOString(),
}) {
  const current = await UserAiUsageStat.findOne({ userId });
  const sameDay = current?.dateKey === dateKey;

  await UserAiUsageStat.findOneAndUpdate(
    { userId },
    {
      userId,
      dateKey,
      lastUsed: timestamp,
      totalMessages: Number(current?.totalMessages || 0) + 1,
      aiMessages: Number(current?.aiMessages || 0) + (usedAi ? 1 : 0),
      dailyUsage: sameDay ? Number(current?.dailyUsage || 0) + 1 : 1,
      aiCallsToday: sameDay
        ? Number(current?.aiCallsToday || 0) + (usedAi ? 1 : 0)
        : (usedAi ? 1 : 0),
      tokensToday: sameDay ? Number(current?.tokensToday || 0) + tokensUsed : tokensUsed,
      totalTokens: Number(current?.totalTokens || 0) + tokensUsed,
      dailyCost: sameDay ? Number(current?.dailyCost || 0) + cost : cost,
      totalCost: Number(current?.totalCost || 0) + cost,
      blockedToday: sameDay
        ? Number(current?.blockedToday || 0) + (blocked ? 1 : 0)
        : (blocked ? 1 : 0),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  todayKey,
  estimateTokens,
  getUsageForDate,
  canUseAi,
  recordUsage,
};
