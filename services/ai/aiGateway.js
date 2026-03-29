const AiUsageLog = require('../../models/AiUsageLog');
const AiDailyStat = require('../../models/AiDailyStat');
const AiEventLog = require('../../models/AiEventLog');

const { detectIntent, canBeHandledByRules } = require('./intentService');
const memoryService = require('./memoryService');
const cacheService = require('./cacheService');
const costControlService = require('./costControlService');
const { routeModel } = require('./modelRouter');

function deterministicResponse(intent) {
  switch (intent) {
    case 'order_tracking':
      return 'I can help track your order. I will use the latest backend order status instead of AI.';
    case 'refund':
      return 'Refund questions are handled directly from payment and order records for accuracy.';
    case 'payment_help':
      return 'Payment help is handled from verified payment records and gateway status.';
    case 'address_update':
      return 'Address changes are handled directly through your saved delivery details.';
    case 'cancel_order':
      return 'Order cancellation is handled by backend order rules and current order status.';
    case 'return_request':
      return 'Return eligibility is checked with backend order and delivery data.';
    default:
      return 'I can help with that.';
  }
}

function fallbackResponse(reason) {
  if (reason === 'daily_token_limit_reached' || reason === 'daily_cost_limit_reached') {
    return 'AI assistance is limited for now, but I can still help with order, payment, refund, and address tasks using backend logic.';
  }
  return 'I can still help with the main support actions even when advanced AI is unavailable.';
}

async function logGatewayUsage({
  userId,
  input,
  response,
  intent,
  source,
  modelName = '',
  cacheKey = '',
  usedAi = false,
  tokensUsed = 0,
  cost = 0,
}) {
  const timestamp = new Date().toISOString();
  const date = timestamp.slice(0, 10);
  const logId = `gateway-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await AiUsageLog.create({
    logId,
    userId,
    message: input,
    responseLength: String(response || '').length,
    tokensUsed,
    cost,
    costPerRequest: cost,
    timestamp,
    intentType: intent,
    usedAi,
    source,
    modelName,
    cacheKey,
  });

  const daily = await AiDailyStat.findOne({ date });
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

async function logBlockedEvent({ userId, input, reason, intent }) {
  await AiEventLog.create({
    eventId: `blocked-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId,
    type: 'ai_blocked',
    message: 'AI request blocked by cost control.',
    prompt: input,
    reason,
    intentType: intent,
    timestamp: new Date().toISOString(),
  });
}

async function callOpenAi({ model, systemPrompt, userPrompt }) {
  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey || !model) {
    return null;
  }

  const response = await fetch(process.env.OPENAI_RESPONSES_ENDPOINT || 'https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_output_tokens: 120,
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: systemPrompt }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: userPrompt }],
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const direct = String(payload.output_text || '').trim();
  if (direct) {
    return direct;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      const text = String(block?.text || block?.output_text || '').trim();
      if (text) {
        return text;
      }
    }
  }

  return null;
}

async function handleAIRequest(input, userContext = {}) {
  const message = String(input || '').trim();
  const userId = String(userContext.userId || '').trim();
  const chatId = String(userContext.chatId || 'general').trim();
  const chatType = String(userContext.chatType || 'general').trim();
  const task = String(userContext.task || 'support').trim();

  if (!message) {
    return {
      success: false,
      statusCode: 400,
      message: 'input is required.',
    };
  }

  const { intent, confidence, requiresAi } = detectIntent({ input: message, chatType });
  const tieredMemory = await memoryService.getTieredMemory({ userId, chatId });
  const cached = await cacheService.getCachedResponse({
    userId,
    input: message,
    chatType,
    intent,
  });

  if (cached?.response) {
    await costControlService.recordUsage({
      userId,
      usedAi: false,
      tokensUsed: 0,
      cost: 0,
    });
    await logGatewayUsage({
      userId,
      input: message,
      response: cached.response,
      intent,
      source: 'cache',
      cacheKey: cached.cacheKey,
      usedAi: false,
    });
    return {
      success: true,
      data: {
        response: cached.response,
        source: 'cache',
        intent,
        confidence,
        cacheKey: cached.cacheKey,
        memory: tieredMemory,
      },
    };
  }

  if (!requiresAi || canBeHandledByRules(intent)) {
    const response = deterministicResponse(intent);
    const cache = await cacheService.setCachedResponse({
      userId,
      input: message,
      response,
      chatType,
      intent,
    });
    await costControlService.recordUsage({
      userId,
      usedAi: false,
      tokensUsed: 0,
      cost: 0,
    });
    await logGatewayUsage({
      userId,
      input: message,
      response,
      intent,
      source: 'rules',
      cacheKey: cache.cacheKey,
      usedAi: false,
    });
    return {
      success: true,
      data: {
        response,
        source: 'rules',
        intent,
        confidence,
        cacheKey: cache.cacheKey,
        memory: tieredMemory,
      },
    };
  }

  const compactContext = [
    `intent: ${intent}`,
    tieredMemory.midTerm ? `summary: ${tieredMemory.midTerm}` : '',
    ...tieredMemory.shortTerm.map((item) => `${item.role}: ${item.text}`),
    `message: ${message}`,
  ].filter(Boolean);

  const estimatedTokens = costControlService.estimateTokens(compactContext);
  const limitMultiplier = userContext.isPremium ? 2 : 1;
  const allowance = await costControlService.canUseAi({
    userId,
    estimatedTokens,
    limitMultiplier,
  });

  if (!allowance.allowed) {
    const response = fallbackResponse(allowance.reason);
    await costControlService.recordUsage({
      userId,
      usedAi: false,
      tokensUsed: 0,
      cost: 0,
      blocked: true,
    });
    await logBlockedEvent({ userId, input: message, reason: allowance.reason, intent });
    await logGatewayUsage({
      userId,
      input: message,
      response,
      intent,
      source: 'fallback',
      usedAi: false,
    });
    return {
      success: true,
      data: {
        response,
        source: 'fallback',
        intent,
        confidence,
        blockedReason: allowance.reason,
        memory: tieredMemory,
      },
    };
  }

  const modelChoice = routeModel({ task, intent });
  if (!modelChoice.model) {
    const response = fallbackResponse('no_ai_route');
    await costControlService.recordUsage({
      userId,
      usedAi: false,
      tokensUsed: 0,
      cost: 0,
    });
    await logGatewayUsage({
      userId,
      input: message,
      response,
      intent,
      source: 'fallback',
      usedAi: false,
    });
    return {
      success: true,
      data: {
        response,
        source: 'fallback',
        intent,
        confidence,
        memory: tieredMemory,
      },
    };
  }

  const aiResponse = await callOpenAi({
    model: modelChoice.model,
    systemPrompt:
      'ABZORA assistant. Keep answers compact, helpful, and ecommerce-specific. Use short answers unless styling detail is needed.',
    userPrompt: compactContext.join('\n'),
  });

  if (!aiResponse) {
    const response = fallbackResponse('ai_unavailable');
    await costControlService.recordUsage({
      userId,
      usedAi: false,
      tokensUsed: 0,
      cost: 0,
    });
    await logGatewayUsage({
      userId,
      input: message,
      response,
      intent,
      source: 'fallback',
      usedAi: false,
    });
    return {
      success: true,
      data: {
        response,
        source: 'fallback',
        intent,
        confidence,
        memory: tieredMemory,
      },
    };
  }

  const cost = Number(((estimatedTokens / 1000) * 0.0025).toFixed(6));
  const cache = await cacheService.setCachedResponse({
    userId,
    input: message,
    response: aiResponse,
    chatType,
    intent,
  });
  await costControlService.recordUsage({
    userId,
    usedAi: true,
    tokensUsed: estimatedTokens,
    cost,
  });
  await logGatewayUsage({
    userId,
    input: message,
    response: aiResponse,
    intent,
    source: 'ai',
    modelName: modelChoice.model,
    cacheKey: cache.cacheKey,
    usedAi: true,
    tokensUsed: estimatedTokens,
    cost,
  });

  return {
    success: true,
    data: {
      response: aiResponse,
      source: 'ai',
      intent,
      confidence,
      model: modelChoice.model,
      cacheKey: cache.cacheKey,
      estimatedTokens,
      memory: tieredMemory,
    },
  };
}

module.exports = {
  handleAIRequest,
};
