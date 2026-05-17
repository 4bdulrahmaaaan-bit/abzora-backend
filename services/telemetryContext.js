const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { getSpanContext } = require('./otelService');

const store = new AsyncLocalStorage();

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function requestId() {
  return randomHex(8);
}

function traceId() {
  return randomHex(16);
}

function spanId() {
  return randomHex(8);
}

function normalizeTraceparent(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-[a-f0-9]{2}$/i);
  if (!match) return null;
  return {
    traceId: match[1].toLowerCase(),
    parentSpanId: match[2].toLowerCase(),
  };
}

function parseIncomingContext(headers = {}) {
  const traceparent = normalizeTraceparent(headers.traceparent || headers['traceparent']);
  return {
    requestId: String(headers['x-request-id'] || '').trim() || requestId(),
    traceId: traceparent?.traceId || traceId(),
    parentSpanId: traceparent?.parentSpanId || '',
    spanId: spanId(),
  };
}

function createChildContext(base = {}, patch = {}) {
  return {
    requestId: String(patch.requestId || base.requestId || requestId()),
    traceId: String(patch.traceId || base.traceId || traceId()),
    parentSpanId: String(patch.parentSpanId || base.spanId || base.parentSpanId || ''),
    spanId: String(patch.spanId || spanId()),
    workerId: String(patch.workerId || base.workerId || ''),
    operation: String(patch.operation || base.operation || ''),
    module: String(patch.module || base.module || ''),
    jobId: String(patch.jobId || base.jobId || ''),
    queueName: String(patch.queueName || base.queueName || ''),
  };
}

function runWithContext(context, fn) {
  return store.run(createChildContext(context || {}), fn);
}

function getContext() {
  const local = store.getStore() || createChildContext({});
  const otel = getSpanContext();
  if (!otel) return local;
  return {
    ...local,
    traceId: local.traceId || otel.traceId || '',
    spanId: local.spanId || otel.spanId || '',
  };
}

function withSpan(patch, fn) {
  const next = createChildContext(getContext(), patch || {});
  return runWithContext(next, fn);
}

function traceparentHeader(context = getContext()) {
  return `00-${context.traceId}-${context.spanId}-01`;
}

function injectContext(payload = {}, context = getContext()) {
  const out = { ...payload };
  out.__trace = {
    requestId: context.requestId,
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId || '',
    workerId: context.workerId || '',
    operation: context.operation || '',
    queueName: context.queueName || '',
  };
  return out;
}

function extractContext(payload = {}) {
  const t = payload?.__trace || payload?.trace || payload?.traceContext || {};
  if (!t || typeof t !== 'object') return null;
  if (!t.traceId && !t.requestId) return null;
  return createChildContext({}, {
    requestId: t.requestId,
    traceId: t.traceId,
    spanId: t.spanId,
    parentSpanId: t.parentSpanId,
    workerId: t.workerId,
    operation: t.operation,
    queueName: t.queueName,
  });
}

module.exports = {
  createChildContext,
  extractContext,
  getContext,
  injectContext,
  parseIncomingContext,
  requestId,
  runWithContext,
  traceparentHeader,
  withSpan,
};
