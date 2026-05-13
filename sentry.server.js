const Sentry = require('@sentry/node');
const { nodeProfilingIntegration } = require('@sentry/profiling-node');

const dsn = String(process.env.SENTRY_DSN || '').trim();
const enabled = Boolean(dsn);

if (enabled) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.2),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0.1),
    integrations: [nodeProfilingIntegration()],
  });
}

function requestHandler() {
  if (typeof Sentry.Handlers?.requestHandler === 'function') {
    return Sentry.Handlers.requestHandler();
  }
  return (_req, _res, next) => next();
}

function errorHandler() {
  if (typeof Sentry.Handlers?.errorHandler === 'function') {
    return Sentry.Handlers.errorHandler();
  }
  return (err, _req, _res, next) => next(err);
}

function captureException(error, context) {
  if (!enabled) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

module.exports = {
  Sentry,
  enabled,
  requestHandler,
  errorHandler,
  captureException,
};

