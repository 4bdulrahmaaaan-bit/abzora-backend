const { diag, DiagConsoleLogger, DiagLogLevel, trace, context, propagation } = require('@opentelemetry/api');

let sdk = null;
let enabled = false;
let started = false;
let exporterProtocol = 'none';
let exporterEndpoint = '';
let droppedSpans = 0;
let lastError = '';
let serviceName = 'abzora-backend';

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function numberEnv(name, fallback, min = 0, max = 1) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function configureDiagnostics() {
  if (boolEnv('OTEL_DIAGNOSTIC_DEBUG', false)) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }
}

function buildExporter() {
  const protocol = String(process.env.OTEL_EXPORTER_PROTOCOL || 'http').trim().toLowerCase();
  const endpoint = String(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '').trim();
  exporterProtocol = protocol;
  exporterEndpoint = endpoint;

  if (!endpoint && process.env.NODE_ENV === 'production') {
    return null;
  }

  if (process.env.NODE_ENV !== 'production' && (!endpoint || protocol === 'console')) {
    // eslint-disable-next-line global-require
    const { ConsoleSpanExporter } = require('@opentelemetry/sdk-trace-base');
    exporterProtocol = 'console';
    return new ConsoleSpanExporter();
  }

  if (protocol === 'grpc') {
    // eslint-disable-next-line global-require
    const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
    return new OTLPTraceExporter({ url: endpoint });
  }

  // eslint-disable-next-line global-require
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  return new OTLPTraceExporter({ url: endpoint });
}

async function startOpenTelemetry() {
  enabled = boolEnv('OTEL_ENABLED', false);
  serviceName = String(process.env.OTEL_SERVICE_NAME || 'abzora-backend').trim() || 'abzora-backend';
  if (!enabled || started) {
    return;
  }

  configureDiagnostics();

  try {
    // eslint-disable-next-line global-require
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    // eslint-disable-next-line global-require
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line global-require
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');
    // eslint-disable-next-line global-require
    const { ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-trace-base');
    // eslint-disable-next-line global-require
    const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
    // eslint-disable-next-line global-require
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    // eslint-disable-next-line global-require
    const { MongoDBInstrumentation } = require('@opentelemetry/instrumentation-mongodb');
    // eslint-disable-next-line global-require
    const { RedisInstrumentation } = require('@opentelemetry/instrumentation-redis-4');

    const exporter = buildExporter();
    const samplingRatio = numberEnv('OTEL_SAMPLING_RATIO', process.env.NODE_ENV === 'production' ? 0.15 : 1, 0, 1);
    const sampler = new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(samplingRatio),
    });

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_NAMESPACE]: 'abzora',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: String(process.env.NODE_ENV || 'development'),
      }),
      sampler,
      traceExporter: exporter || undefined,
      instrumentations: [
        new HttpInstrumentation(),
        new ExpressInstrumentation(),
        new MongoDBInstrumentation(),
        new RedisInstrumentation(),
      ],
    });

    await sdk.start();
    started = true;
  } catch (error) {
    lastError = String(error?.message || error);
    droppedSpans += 1;
  }
}

async function shutdownOpenTelemetry() {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (error) {
    lastError = String(error?.message || error);
  } finally {
    sdk = null;
    started = false;
  }
}

function getTracer(name = 'abzora-backend') {
  return trace.getTracer(name);
}

function getSpanContext() {
  const active = trace.getSpan(context.active());
  return active?.spanContext?.() || null;
}

function setActiveContextFromCarrier(carrier = {}) {
  const extracted = propagation.extract(context.active(), carrier);
  return extracted;
}

function injectActiveContext(carrier = {}) {
  propagation.inject(context.active(), carrier);
  return carrier;
}

function runWithOtelContext(ctx, fn) {
  return context.with(ctx, fn);
}

function startSpan(name, attributes = {}, options = {}) {
  const tracer = getTracer('abzora-backend');
  const span = tracer.startSpan(name, {
    attributes,
    ...options,
  });
  return span;
}

function getOtelHealth() {
  return {
    enabled,
    started,
    serviceName,
    exporter: {
      protocol: exporterProtocol,
      endpoint: exporterEndpoint,
      status: started ? 'ready' : (enabled ? 'degraded' : 'disabled'),
    },
    droppedSpans,
    backpressure: {
      indicator: droppedSpans > 0 ? 'elevated' : 'normal',
    },
    lastError,
  };
}

module.exports = {
  getOtelHealth,
  getSpanContext,
  getTracer,
  injectActiveContext,
  runWithOtelContext,
  setActiveContextFromCarrier,
  shutdownOpenTelemetry,
  startOpenTelemetry,
  startSpan,
};

