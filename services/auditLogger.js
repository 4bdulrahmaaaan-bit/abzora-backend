const logger = require('./structuredLogger');
const telemetry = require('./telemetryContext');

function nowIso() {
  return new Date().toISOString();
}

function requestId() { return telemetry.requestId(); }

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
  const payload = { timestamp: nowIso(), ...details };
  if (level === 'error') return logger.error(event, payload);
  if (level === 'warn') return logger.warn(event, payload);
  return logger.info(event, payload);
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
