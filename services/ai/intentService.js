const RULE_INTENTS = new Set([
  'order_tracking',
  'refund',
  'payment_help',
  'address_update',
  'cancel_order',
  'return_request',
]);

function normalizeText(text = '') {
  return text.toLowerCase().trim().replace(/\s+/g, ' ');
}

function detectIntent({ input = '', chatType = '' }) {
  const text = normalizeText(input);
  const normalizedChatType = normalizeText(chatType);

  if (
    normalizedChatType === 'order' ||
    /where.*order|track|delivery status|when will it arrive|where is my order/.test(text)
  ) {
    return { intent: 'order_tracking', confidence: 0.94, requiresAi: false };
  }

  if (
    normalizedChatType === 'refund' ||
    /refund|money back|refund status|when.*refund/.test(text)
  ) {
    return { intent: 'refund', confidence: 0.92, requiresAi: false };
  }

  if (
    normalizedChatType === 'payment' ||
    /payment|upi|card|razorpay|failed payment|charged twice/.test(text)
  ) {
    return { intent: 'payment_help', confidence: 0.9, requiresAi: false };
  }

  if (
    /change address|update address|wrong address|new address|deliver to/.test(text)
  ) {
    return { intent: 'address_update', confidence: 0.89, requiresAi: false };
  }

  if (/cancel order|cancel my order|stop order/.test(text)) {
    return { intent: 'cancel_order', confidence: 0.92, requiresAi: false };
  }

  if (normalizedChatType === 'return' || /return|exchange|pickup/.test(text)) {
    return { intent: 'return_request', confidence: 0.88, requiresAi: false };
  }

  if (
    normalizedChatType === 'custom' ||
    /style|fit|size|matching|what should i wear|recommend|look|outfit/.test(text)
  ) {
    return { intent: 'styling_help', confidence: 0.83, requiresAi: true };
  }

  return { intent: 'general_support', confidence: 0.55, requiresAi: true };
}

function canBeHandledByRules(intent) {
  return RULE_INTENTS.has(intent);
}

module.exports = {
  detectIntent,
  canBeHandledByRules,
};
