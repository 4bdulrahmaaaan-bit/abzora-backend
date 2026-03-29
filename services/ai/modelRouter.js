function routeModel({ task = 'support', intent = 'general_support' }) {
  if (task === 'kyc' || task === 'vision') {
    return {
      route: 'vision',
      model: process.env.OPENAI_VISION_MODEL || 'gpt-4.1-mini',
    };
  }

  if (task === 'personalization' || intent === 'styling_help') {
    return {
      route: 'medium',
      model: process.env.OPENAI_MODEL_MEDIUM || 'gpt-5-mini',
    };
  }

  if (intent === 'general_support') {
    return {
      route: 'cheap',
      model: process.env.OPENAI_MODEL_CHEAP || 'gpt-5-nano',
    };
  }

  return {
    route: 'none',
    model: null,
  };
}

module.exports = {
  routeModel,
};
