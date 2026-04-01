const ConversationMemoryEntry = require('../models/ConversationMemoryEntry');
const SupportResponseCache = require('../models/SupportResponseCache');
const AiUsageLog = require('../models/AiUsageLog');
const AiDailyStat = require('../models/AiDailyStat');
const UserAiUsageStat = require('../models/UserAiUsageStat');
const AiEventLog = require('../models/AiEventLog');

const memoryService = require('../services/ai/memoryService');
const cacheService = require('../services/ai/cacheService');
const costControlService = require('../services/ai/costControlService');
const { handleAIRequest } = require('../services/ai/aiGateway');

function isAdmin(req) {
  return req.user?.role === 'admin' || req.user?.role === 'super_admin';
}

function ensureAdmin(req, res) {
  if (!isAdmin(req)) {
    res.status(403).json({ success: false, message: 'Admin access required.' });
    return false;
  }
  return true;
}

const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

function normalizeFit(value) {
  const normalized = (value || '').toString().trim().toLowerCase();
  if (normalized === 'slim' || normalized === 'regular' || normalized === 'oversized') {
    return normalized;
  }
  return 'regular';
}

function clampSizeIndex(index) {
  return Math.max(0, Math.min(SIZE_ORDER.length - 1, index));
}

function confidenceLabel(score) {
  if (score >= 0.86) return 'high';
  if (score >= 0.72) return 'medium';
  return 'low';
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildSizeRecommendation({ height, weight, bodyType, productFit }) {
  let index = 1; // S
  if (weight >= 60 && weight <= 75) {
    index = 2; // M
  } else if (weight > 75) {
    index = 3; // L
  }

  const reasons = ['Base size from weight'];

  if (height > 180) {
    index += 1;
    reasons.push('Increased for taller height');
  } else if (height < 165) {
    index -= 1;
    reasons.push('Reduced for shorter height');
  }

  if (bodyType === 'slim') {
    index -= 1;
    reasons.push('Adjusted down for slim body type');
  } else if (bodyType === 'heavy') {
    index += 1;
    reasons.push('Adjusted up for heavy body type');
  }

  if (productFit === 'slim') {
    index += 1;
    reasons.push('Adjusted up for slim-fit product');
  } else if (productFit === 'oversized') {
    index -= 1;
    reasons.push('Adjusted down for oversized product');
  }

  index = clampSizeIndex(index);
  const normalizedConfidence = confidenceLabel(
    Math.max(
      0.62,
      Math.min(
        0.94,
        0.82 -
          ((height < 150 || height > 195) ? 0.06 : 0) -
          ((weight < 45 || weight > 110) ? 0.05 : 0),
      ),
    ),
  );

  return {
    recommendedSize: SIZE_ORDER[index],
    confidence: normalizedConfidence,
    message: 'Best fit based on your body profile',
    reasoning: reasons.join(', '),
  };
}

async function runAiGateway(req, res, next) {
  try {
    const result = await handleAIRequest(req.body?.input, {
      userId: req.user.uid,
      chatId: req.body?.chatId?.toString().trim() || 'general',
      chatType: req.body?.chatType?.toString().trim() || 'general',
      task: req.body?.task?.toString().trim() || 'support',
      isPremium: req.user?.role === 'premium' || req.user?.role === 'vip',
    });

    if (!result.success) {
      return res.status(result.statusCode || 400).json({
        success: false,
        message: result.message || 'Unable to process AI request.',
      });
    }

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
}

async function recommendSize(req, res, next) {
  try {
    const height = parseNumber(req.body?.height ?? req.body?.heightCm);
    const weight = parseNumber(req.body?.weight ?? req.body?.weightKg);
    const bodyType = (req.body?.bodyType || 'regular').toString().trim().toLowerCase();
    const productFit = normalizeFit(req.body?.productFit);

    if (height == null || weight == null) {
      return res.status(400).json({
        success: false,
        message: 'height and weight are required.',
      });
    }

    const recommendation = buildSizeRecommendation({
      height,
      weight,
      bodyType,
      productFit,
    });

    return res.status(200).json({
      success: true,
      data: recommendation,
    });
  } catch (error) {
    return next(error);
  }
}

async function getChatHistory(req, res, next) {
  try {
    const chatId = req.params.chatId?.toString() || '';
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 15)));
    const items = await ConversationMemoryEntry.find({
      userId: req.user.uid,
      chatId,
    })
      .sort({ timestamp: -1, _id: -1 })
      .limit(limit);
    const ordered = items.reverse().map((item) => ({
      id: item.entryId,
      role: item.role,
      text: item.text,
      timestamp: item.timestamp,
    }));
    return res.status(200).json({ success: true, data: ordered });
  } catch (error) {
    return next(error);
  }
}

async function appendChatHistoryEntry(req, res, next) {
  try {
    const chatId = req.params.chatId?.toString() || '';
    const entryId = req.body?.id?.toString().trim() || '';
    const role = req.body?.role?.toString().trim() || 'user';
    const text = req.body?.text?.toString() || '';
    const timestamp = req.body?.timestamp?.toString().trim() || new Date().toISOString();
    if (!entryId || !text.trim()) {
      return res.status(400).json({ success: false, message: 'id and text are required.' });
    }

    await memoryService.appendHistoryEntry({
      userId: req.user.uid,
      chatId,
      entryId,
      role,
      text,
      timestamp,
    });

    return res.status(201).json({ success: true, data: { id: entryId } });
  } catch (error) {
    return next(error);
  }
}

async function clearUserMemory(req, res, next) {
  try {
    await memoryService.clearHistory(req.user.uid);
    return res.status(200).json({ success: true, data: { cleared: true } });
  } catch (error) {
    return next(error);
  }
}

async function getSupportCache(req, res, next) {
  try {
    const cacheInput = req.query.key?.toString().trim() || '';
    if (!cacheInput) {
      return res.status(400).json({ success: false, message: 'Cache key is required.' });
    }
    const item = await cacheService.getCachedResponse({
      userId: req.user.uid,
      input: cacheInput,
      chatType: req.query.chatType?.toString().trim() || 'general',
      intent: req.query.intent?.toString().trim() || '',
    });
    return res.status(200).json({ success: true, data: item });
  } catch (error) {
    return next(error);
  }
}

async function setSupportCache(req, res, next) {
  try {
    const input = req.body?.key?.toString().trim() || '';
    const responseText = req.body?.response?.toString() || '';
    const intent = req.body?.intent?.toString().trim() || 'ai_needed';
    const chatType = req.body?.chatType?.toString().trim() || 'general';
    const updatedAt = req.body?.updatedAt?.toString().trim() || new Date().toISOString();
    if (!input || !responseText.trim()) {
      return res.status(400).json({ success: false, message: 'key and response are required.' });
    }
    const cache = await cacheService.setCachedResponse({
      userId: req.user.uid,
      input,
      response: responseText,
      chatType,
      intent,
      updatedAt,
    });
    return res.status(201).json({ success: true, data: cache });
  } catch (error) {
    return next(error);
  }
}

async function getTodayUsage(req, res, next) {
  try {
    const dateKey = req.query.date?.toString().trim() || costControlService.todayKey();
    const usage = await costControlService.getUsageForDate(req.user.uid, dateKey);
    return res.status(200).json({ success: true, data: usage });
  } catch (error) {
    return next(error);
  }
}

async function incrementTodayUsage(req, res, next) {
  try {
    const dateKey = req.body?.dateKey?.toString().trim() || costControlService.todayKey();
    await costControlService.recordUsage({
      userId: req.user.uid,
      dateKey,
      usedAi: true,
      tokensUsed: Number(req.body?.tokensUsed || 0),
      cost: Number(req.body?.cost || 0),
      timestamp: req.body?.timestamp?.toString().trim() || new Date().toISOString(),
    });
    const usage = await costControlService.getUsageForDate(req.user.uid, dateKey);
    return res.status(200).json({ success: true, data: usage });
  } catch (error) {
    return next(error);
  }
}

async function logAiUsage(req, res, next) {
  try {
    const logId = req.body?.id?.toString().trim() || `ai-${Date.now()}`;
    const date = req.body?.date?.toString().trim() || '';
    const timestamp = req.body?.timestamp?.toString().trim() || new Date().toISOString();
    const usedAi = req.body?.usedAi == true;
    const cost = Number(req.body?.cost || 0);
    const daily = await AiDailyStat.findOne({ date });
    const userUsage = await UserAiUsageStat.findOne({ userId: req.user.uid });

    await AiUsageLog.findOneAndUpdate(
      { logId },
      {
        logId,
        userId: req.user.uid,
        message: req.body?.message?.toString() || '',
        responseLength: Number(req.body?.responseLength || 0),
        tokensUsed: Number(req.body?.tokensUsed || 0),
        cost,
        costPerRequest: Number(req.body?.costPerRequest || cost),
        timestamp,
        intentType: req.body?.intentType?.toString() || 'ai_needed',
        usedAi,
        source: req.body?.source?.toString() || (usedAi ? 'ai' : 'logic'),
        modelName: req.body?.modelName?.toString() || '',
        cacheKey: req.body?.cacheKey?.toString() || '',
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (date) {
      await AiDailyStat.findOneAndUpdate(
        { date },
        {
          date,
          totalRequests: Number(daily?.totalRequests || 0) + 1,
          totalCost: Number(daily?.totalCost || 0) + cost,
          aiRequests: Number(daily?.aiRequests || 0) + (usedAi ? 1 : 0),
          logicRequests: Number(daily?.logicRequests || 0) + (usedAi ? 0 : 1),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    await UserAiUsageStat.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        totalMessages: Number(userUsage?.totalMessages || 0) + 1,
        aiMessages: Number(userUsage?.aiMessages || 0) + (usedAi ? 1 : 0),
        lastUsed: timestamp,
        dailyUsage: date && userUsage?.dateKey === date ? Number(userUsage?.dailyUsage || 0) + 1 : 1,
        dateKey: date || userUsage?.dateKey || '',
        aiCallsToday:
          date && userUsage?.dateKey === date
            ? Number(userUsage?.aiCallsToday || 0) + (usedAi ? 1 : 0)
            : (usedAi ? 1 : 0),
        tokensToday:
          date && userUsage?.dateKey === date
            ? Number(userUsage?.tokensToday || 0) + Number(req.body?.tokensUsed || 0)
            : Number(req.body?.tokensUsed || 0),
        totalTokens: Number(userUsage?.totalTokens || 0) + Number(req.body?.tokensUsed || 0),
        dailyCost:
          date && userUsage?.dateKey === date
            ? Number(userUsage?.dailyCost || 0) + cost
            : cost,
        totalCost: Number(userUsage?.totalCost || 0) + cost,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ success: true, data: { id: logId } });
  } catch (error) {
    return next(error);
  }
}

async function listAiUsageLogs(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 120)));
    const logs = await AiUsageLog.find({}).sort({ timestamp: -1, _id: -1 }).limit(limit);
    return res.status(200).json({
      success: true,
      data: logs.map((item) => ({
        id: item.logId,
        userId: item.userId,
        message: item.message,
        responseLength: Number(item.responseLength || 0),
        tokensUsed: Number(item.tokensUsed || 0),
        cost: Number(item.cost || 0),
        costPerRequest: Number(item.costPerRequest || 0),
        timestamp: item.timestamp,
        intentType: item.intentType,
        usedAi: item.usedAi,
        source: item.source || 'logic',
        modelName: item.modelName || '',
        cacheKey: item.cacheKey || '',
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function listAiDailyStats(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const stats = await AiDailyStat.find({}).sort({ date: 1, _id: 1 });
    return res.status(200).json({
      success: true,
      data: stats.map((item) => ({
        date: item.date,
        totalRequests: Number(item.totalRequests || 0),
        totalCost: Number(item.totalCost || 0),
        aiRequests: Number(item.aiRequests || 0),
        logicRequests: Number(item.logicRequests || 0),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function listUserAiUsageStats(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const stats = await UserAiUsageStat.find({}).sort({ aiMessages: -1, _id: 1 });
    return res.status(200).json({
      success: true,
      data: stats.map((item) => ({
        userId: item.userId,
        totalMessages: Number(item.totalMessages || 0),
        aiMessages: Number(item.aiMessages || 0),
        lastUsed: item.lastUsed || '',
        dailyUsage: Number(item.dailyUsage || 0),
        aiCallsToday: Number(item.aiCallsToday || 0),
        tokensToday: Number(item.tokensToday || 0),
        totalTokens: Number(item.totalTokens || 0),
        dailyCost: Number(item.dailyCost || 0),
        totalCost: Number(item.totalCost || 0),
        blockedToday: Number(item.blockedToday || 0),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

async function logAiEvent(req, res, next) {
  try {
    const eventId = req.body?.id?.toString().trim() || `${req.body?.type?.toString().trim() || 'event'}-${Date.now()}`;
    await AiEventLog.findOneAndUpdate(
      { eventId },
      {
        eventId,
        userId: req.user.uid,
        type: req.body?.type?.toString().trim() || 'event',
        message: req.body?.message?.toString() || '',
        prompt: req.body?.prompt?.toString() || '',
        reason: req.body?.reason?.toString() || '',
        intentType: req.body?.intentType?.toString() || '',
        timestamp: req.body?.timestamp?.toString().trim() || new Date().toISOString(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(201).json({ success: true, data: { id: eventId } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  runAiGateway,
  recommendSize,
  getChatHistory,
  appendChatHistoryEntry,
  clearUserMemory,
  getSupportCache,
  setSupportCache,
  getTodayUsage,
  incrementTodayUsage,
  logAiUsage,
  listAiUsageLogs,
  listAiDailyStats,
  listUserAiUsageStats,
  logAiEvent,
};
