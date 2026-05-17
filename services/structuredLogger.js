const { getContext } = require('./telemetryContext');
const metrics = require('./telemetryMetrics');

const REDACT_KEYS = [
  'authorization',
  'cookie',
  'password',
  'token',
  'secret',
  'signature',
  'privatekey',
  'razorpay_webhook_secret',
];

const MAX_STRING = 512;
const MAX_KEYS = 60;

let droppedLogs = 0;

function levelEnabled(level) {
  const configured = String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
  const order = ['debug', 'info', 'warn', 'error'];
  return order.indexOf(level) >= order.indexOf(configured);
}

function shouldRedact(key) {
  const k = String(key || '').toLowerCase();
  return REDACT_KEYS.some((item) => k.includes(item));
}

function truncateString(value) {
  const s = String(value ?? '');
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}...[truncated]` : s;
}

function sanitize(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[max-depth]';
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value).slice(0, MAX_KEYS);
    for (const k of keys) {
      if (shouldRedact(k)) {
        out[k] = '[redacted]';
      } else {
        out[k] = sanitize(value[k], depth + 1);
      }
    }
    return out;
  }
  return truncateString(value);
}

function log(level, event, fields = {}) {
  if (!levelEnabled(level)) return;
  try {
    const ctx = getContext();
    const payload = sanitize({
      level,
      event,
      timestamp: new Date().toISOString(),
      requestId: ctx.requestId || '',
      traceId: ctx.traceId || '',
      spanId: ctx.spanId || '',
      workerId: ctx.workerId || '',
      operation: ctx.operation || '',
      module: fields.module || ctx.module || '',
      ...fields,
    });
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify(payload));
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(JSON.stringify(payload));
    } else {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(payload));
    }
  } catch (_) {
    droppedLogs += 1;
    metrics.inc('telemetry_logs_dropped_total', 1);
  }
}

function debug(event, fields = {}) { log('debug', event, fields); }
function info(event, fields = {}) { log('info', event, fields); }
function warn(event, fields = {}) { log('warn', event, fields); }
function error(event, fields = {}) { log('error', event, fields); }

function getLoggerHealth() {
  return {
    droppedLogs,
    level: String(process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase(),
  };
}

module.exports = {
  debug,
  error,
  getLoggerHealth,
  info,
  warn,
};

