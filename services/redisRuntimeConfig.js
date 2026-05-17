function boolEnv(name, defaultValue = false) {
  const raw = String(process.env[name] ?? defaultValue).trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function isRedisRequired() {
  if (process.env.NODE_ENV === 'production') {
    return boolEnv('REDIS_REQUIRED', true);
  }
  return boolEnv('REDIS_REQUIRED', false);
}

function isRedisDisabled() {
  return boolEnv('REDIS_DISABLED', false);
}

function getRedisUrl() {
  return String(process.env.REDIS_URL || '').trim();
}

function allowMemoryFallback() {
  return !isRedisRequired();
}

function getRedisConfigSummary() {
  return {
    required: isRedisRequired(),
    disabled: isRedisDisabled(),
    configured: Boolean(getRedisUrl()),
  };
}

module.exports = {
  allowMemoryFallback,
  getRedisConfigSummary,
  getRedisUrl,
  isRedisDisabled,
  isRedisRequired,
};

