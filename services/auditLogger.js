const crypto = require('crypto');

function nowIso() {
  return new Date().toISOString();
}

function requestId() {
  return crypto.randomBytes(8).toString('hex');
}

function safeString(value, max = 240) {
  const normalized = value == null ? '' : String(value).trim();
  if (!normalized) {
    return '';
  }
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

function clientIp(req) {
  return safeString(
    req.headers['x-forwarded-for']?.toString().split(',')[0] ||
      req.ip ||
      req.socket?.remoteAddress ||
      '',
    64,
  );
}

function baseLog(level, event, details = {}) {
  const payload = {
    level,
    event,
    timestamp: nowIso(),
    ...details,
  };
  const line = JSON.stringify(payload);
  if (level === 'error' || level === 'warn') {
    console[level](line);
    return;
  }
  console.log(line);
}

function logSecurityEvent(event, details = {}) {
  baseLog('info', event, details);
}

function logSecurityWarning(event, details = {}) {
  baseLog('warn', event, details);
}

function logSecurityError(event, details = {}) {
  baseLog('error', event, details);
}

module.exports = {
  clientIp,
  logSecurityError,
  logSecurityEvent,
  logSecurityWarning,
  requestId,
  safeString,
};
