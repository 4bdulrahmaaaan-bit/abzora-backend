const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:4173',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:5173',
];

const { clientIp, logSecurityEvent, logSecurityWarning, requestId, safeString } = require('../services/auditLogger');
const {
  getRedisConfigSummary,
  getRedisUrl,
  isRedisDisabled,
  isRedisRequired,
} = require('../services/redisRuntimeConfig');
const { ensureRedisClient } = require('../services/redisClientManager');

let redisLimiterClient = null;
let redisLimiterAvailable = false;

function failClosedRateLimitOnRedisDown() {
  // Security hardening: production can reject requests when distributed limiter is unavailable
  // to prevent abuse bypass across horizontally scaled instances.
  if (isRedisRequired()) {
    return true;
  }
  if (process.env.NODE_ENV === 'production') {
    return String(process.env.RATE_LIMIT_FAIL_CLOSED || 'true').trim().toLowerCase() !== 'false';
  }
  return String(process.env.RATE_LIMIT_FAIL_CLOSED || 'false').trim().toLowerCase() === 'true';
}

async function ensureRedisLimiterClient() {
  if (redisLimiterClient || isRedisDisabled()) {
    return redisLimiterClient;
  }
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    if (isRedisRequired()) {
      logSecurityWarning('rate_limiter_redis_required_missing_url', {});
    }
    return null;
  }
  try {
    redisLimiterClient = await ensureRedisClient();
    if (!redisLimiterClient) {
      redisLimiterAvailable = false;
      return null;
    }
    redisLimiterClient.on('error', () => {
      redisLimiterAvailable = false;
    });
    redisLimiterClient.on('ready', () => {
      redisLimiterAvailable = true;
    });
    redisLimiterAvailable = true;
    return redisLimiterClient;
  } catch (_) {
    redisLimiterClient = null;
    redisLimiterAvailable = false;
    return null;
  }
}

function buildAllowedOrigins() {
  const configured = (process.env.CLIENT_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured;
  }

  if (process.env.NODE_ENV === 'production') {
    return [];
  }

  return DEFAULT_DEV_ORIGINS;
}

function createCorsOptions() {
  const allowedOrigins = buildAllowedOrigins();
  return {
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS.'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self';",
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  next();
}

function enforceHttps(req, res, next) {
  if (process.env.NODE_ENV !== 'production' || process.env.ENFORCE_HTTPS === 'false') {
    return next();
  }
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').trim().toLowerCase();
  if (proto === 'https') {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'HTTPS is required.',
  });
}

function requestContext(req, res, next) {
  req.requestId = requestId();
  req.requestStartedAt = Date.now();
  res.setHeader('X-Request-Id', req.requestId);
  return next();
}

function requestAuditLogger(req, res, next) {
  const startedAt = Date.now();
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength > 2 * 1024 * 1024) {
    logSecurityWarning('unusual_large_request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      ip: clientIp(req),
      contentLength,
    });
  }

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    const payload = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: clientIp(req),
      userId: safeString(req.user?.uid || req.dbUser?.uid || ''),
      userRole: safeString(req.user?.role || ''),
    };
    if (res.statusCode >= 500) {
      logSecurityWarning('api_error', payload);
      return;
    }
    if (res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429) {
      logSecurityWarning('security_sensitive_response', payload);
      return;
    }
    if (durationMs > 5000) {
      logSecurityWarning('slow_request', payload);
      return;
    }
    logSecurityEvent('api_request', payload);
  });

  return next();
}

function createRateLimiter({
  windowMs,
  max,
  message,
  keyGenerator,
}) {
  const store = new Map();

  function cleanup(now) {
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
  }

  return async function rateLimiter(req, res, next) {
    const now = Date.now();
    cleanup(now);

    const key = keyGenerator
      ? keyGenerator(req)
      : `${req.ip || 'unknown'}:${req.baseUrl || ''}`;

    const redisKey = `rate-limit:${key}`;
    const redisClient = await ensureRedisLimiterClient();
    if (redisClient && redisLimiterAvailable) {
      try {
        const currentCount = await redisClient.incr(redisKey);
        if (currentCount === 1) {
          await redisClient.pExpire(redisKey, windowMs);
        }
        if (currentCount > max) {
          const remainingMs = Number(await redisClient.pTTL(redisKey));
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((remainingMs > 0 ? remainingMs : windowMs) / 1000)
          );
          res.setHeader('Retry-After', retryAfterSeconds.toString());
          res.status(429).json({
            success: false,
            message,
          });
          logSecurityWarning('rate_limit_blocked', {
            requestId: req.requestId,
            key,
            path: req.originalUrl,
            ip: clientIp(req),
          });
          return;
        }
        next();
        return;
      } catch (_) {
        redisLimiterAvailable = false;
      }
    }

    if (
      process.env.NODE_ENV === 'production' &&
      failClosedRateLimitOnRedisDown()
    ) {
      res.setHeader('Retry-After', '5');
      res.status(503).json({
        success: false,
        message: 'Rate limiting backend unavailable. Please retry shortly.',
      });
      logSecurityWarning('rate_limit_backend_unavailable', {
        requestId: req.requestId,
        key,
        path: req.originalUrl,
        ip: clientIp(req),
      });
      return;
    }

    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((entry.resetAt - now) / 1000)
      );
      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json({
        success: false,
        message,
      });
      logSecurityWarning('rate_limit_blocked', {
        requestId: req.requestId,
        key,
        path: req.originalUrl,
        ip: clientIp(req),
      });
      return;
    }

    entry.count += 1;
    next();
  };
}

function getRateLimiterRedisStatus() {
  const config = getRedisConfigSummary();
  return {
    configured: config.configured && !config.disabled,
    required: config.required,
    connected: Boolean(redisLimiterClient?.isOpen) && redisLimiterAvailable,
    backend: (Boolean(redisLimiterClient) && redisLimiterAvailable) ? 'redis' : 'unavailable',
  };
}

async function closeRateLimiterRedisClient() {
  if (!redisLimiterClient) {
    return;
  }
  redisLimiterClient = null;
  redisLimiterAvailable = false;
}

module.exports = {
  async initializeRateLimiterRedis() {
    await ensureRedisLimiterClient();
  },
  closeRateLimiterRedisClient,
  createCorsOptions,
  createRateLimiter,
  enforceHttps,
  getRateLimiterRedisStatus,
  requestAuditLogger,
  requestContext,
  securityHeaders,
};
