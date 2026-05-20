require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const sentry = require('./sentry.server');

const connectDBModule = require('./config/db');
const connectDB = connectDBModule;
const { closeDBConnection, getMongoHealth } = connectDBModule;
require('./config/cloudinary');
const initializeFirebase = require('./config/firebase');
const {
  initializeRateLimiterRedis,
  createCorsOptions,
  createRateLimiter,
  enforceHttps,
  getRateLimiterRedisStatus,
  requestAuditLogger,
  requestContext,
  securityHeaders,
  closeRateLimiterRedisClient,
} = require('./middleware/securityMiddleware');
const authMiddleware = require('./middleware/authMiddleware');
const {
  requireAdmin,
  requireRider,
  requireVendor,
} = require('./middleware/authorizationMiddleware');
const { me } = require('./controllers/authController');
const { getFinanceCronStatus, scheduleFinanceCrons, stopFinanceCrons } = require('./services/financeCronService');
const { clientIp, logSecurityError } = require('./services/auditLogger');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const productRoutes = require('./routes/productRoutes');
const storeRoutes = require('./routes/storeRoutes');
const orderRoutes = require('./routes/orderRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');
const cardRoutes = require('./routes/cardRoutes');
const chatRoutes = require('./routes/chatRoutes');
const supportRoutes = require('./routes/supportRoutes');
const aiRoutes = require('./routes/aiRoutes');
const adminRoutes = require('./routes/adminRoutes');
const vendorRoutes = require('./routes/vendorRoutes');
const riderRoutes = require('./routes/riderRoutes');
const kycRoutes = require('./routes/kycRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const bookingRoutes = require('./routes/bookingRoutes');
const bannerRoutes = require('./routes/bannerRoutes');
const homeVisualRoutes = require('./routes/homeVisualRoutes');
const categoryRoutes = require('./routes/category.routes');
const outfitRoutes = require('./routes/outfitRoutes');
const socialRoutes = require('./routes/socialRoutes');
const webhookRoutes = require('./routes/webhookRoutes');
const financeRoutes = require('./routes/financeRoutes');
const walletRoutes = require('./routes/walletRoutes');
const payoutRoutes = require('./routes/payoutRoutes');
const arRoutes = require('./routes/arRoutes');
const trialHomeRoutes = require('./routes/trialHomeRoutes');
const ctaRoutes = require('./routes/ctaRoutes');
const experienceRoutes = require('./routes/experienceRoutes');
const mlRoutes = require('./routes/mlRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const logisticsRoutes = require('./routes/logisticsRoutes');
const dispatchRoutes = require('./routes/dispatchRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const atelierRoutes = require('./routes/atelierRoutes');
const opsRoutes = require('./routes/opsRoutes');
const fleetRoutes = require('./routes/fleetRoutes');
const wardrobeRoutes = require('./routes/wardrobeRoutes');
const debugRoutes = require('./routes/debugRoutes');
const legalRoutes = require('./routes/legalRoutes');
const invoiceRoutes = require('./routes/invoiceRoutes');
const adminInvoiceRoutes = require('./routes/adminInvoiceRoutes');
const { verifyInvoicePublic } = require('./controllers/invoiceController');
const {
  attachTrackingGateway,
  closeTrackingGateway,
  getTrackingGatewayStatus,
  initializeTrackingRedis,
} = require('./services/trackingGateway');
const { attachPricingGateway, closePricingGateway, getPricingGatewayStatus } = require('./services/pricingGateway');
const { getDispatchSchedulerStatus, startDispatchScheduler, stopDispatchScheduler } = require('./services/dispatchSchedulerService');
const { startInvoiceQueueWorker, stopInvoiceQueueWorker, getInvoiceQueueWorkerStatus } = require('./services/invoiceQueueWorkerService');
const { startInvoiceBullMqWorkers } = require('./services/invoiceBullMqOrchestrator');
const { bullMqHealth, closeBullMq } = require('./services/bullMqService');
const { getOpsRuntimeStatus, startOpsRuntime, stopOpsRuntime } = require('./services/opsRuntimeService');
const { startPaymentOutboxWorker, stopPaymentOutboxWorker } = require('./services/paymentOutboxWorker');
const { processPaymentWebhookIngestEvent } = require('./controllers/paymentController');
const {
  startPaymentWebhookIngestWorker,
  stopPaymentWebhookIngestWorker,
} = require('./services/paymentWebhookIngestService');
const {
  closeQueueClient,
  getQueueRuntimeStatus,
  initializeOpsQueueRedis,
} = require('./services/opsQueueService');
const {
  closeOpsLockClient,
  getOpsLockRuntimeStatus,
  initializeOpsLockRedis,
} = require('./services/opsLockService');
const {
  closeRedisCacheClient,
  getRuntimeStatus: getCacheRuntimeStatus,
  initializeRedisCacheClient,
} = require('./services/redisCacheService');
const { getRedisConfigSummary } = require('./services/redisRuntimeConfig');
const {
  closeRedisClientManager,
  getRedisManagerStatus,
  warmupRedisClient,
} = require('./services/redisClientManager');
const { getLoggerHealth } = require('./services/structuredLogger');
const telemetryMetrics = require('./services/telemetryMetrics');
const logger = require('./services/structuredLogger');
const { getOtelHealth, shutdownOpenTelemetry, startOpenTelemetry } = require('./services/otelService');
const { getOrderEta } = require('./controllers/dispatchController');
const { getOutboxMetrics, getOutboxWorkerHealth } = require('./controllers/outboxOpsController');
const { getWebhookIngestHealth, getWebhookIngestMetrics } = require('./controllers/webhookIngestOpsController');
const { renderInvoicePrometheusMetrics } = require('./services/invoicePrometheusMetricsService');
const { startInvoiceQueueSelfHealing, stopInvoiceQueueSelfHealing } = require('./services/invoiceQueueSelfHealingService');
const {
  getStorageHealth,
  getEmailHealth,
  getInvoiceHealth,
  getQueueHealth,
} = require('./services/invoiceDiagnosticsService');

const app = express();
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '0.0.0.0';
app.set('trust proxy', 1);
let httpServer = null;
let shuttingDown = false;

app.use(cors(createCorsOptions()));
app.use(requestContext);
app.use(requestAuditLogger);
app.use(enforceHttps);
app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sentry.requestHandler());

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: 'Too many authentication requests. Please wait and try again.',
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    return `auth:${clientIp(req)}:${email || phone || 'anon'}`;
  },
});

const orderLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: 'Too many order requests. Please slow down and try again.',
});

const paymentLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: 'Too many payment requests. Please wait and try again.',
});

const withdrawalLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many withdrawal requests. Please wait and try again.',
});

const adminLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many admin requests. Please wait and try again.',
});

const supportLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 120,
  message: 'Too many support requests. Please wait and try again.',
});

const chatLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 180,
  message: 'Too many chat requests. Please wait and try again.',
});

const socialLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 160,
  message: 'Too many social actions. Please slow down and try again.',
});

const webhookLimiter = createRateLimiter({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: 'Webhook rate exceeded. Please retry shortly.',
  keyGenerator: (req) => `webhook:${clientIp(req)}:${req.path || req.originalUrl || ''}`,
});

const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many upload requests. Please wait and try again.',
});

const outboxMetricsLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Too many outbox metrics requests. Please try again later.',
});

const aiLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many AI requests. Please slow down and try again.',
  keyGenerator: (req) => `ai:${req.user?.uid || clientIp(req)}`,
});

const accountCreationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many account setup attempts. Please try again later.',
  keyGenerator: (req) => `account:${clientIp(req)}:${String(req.body?.phone || req.body?.email || '').trim()}`,
});

app.use('/webhooks/razorpayx', webhookLimiter, express.raw({ type: 'application/json', limit: '1mb' }));
app.use('/webhooks/razorpay', webhookLimiter, express.raw({ type: 'application/json', limit: '1mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: shuttingDown ? 'draining' : 'ok',
    service: 'abzora-backend',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    service: 'abzora-backend',
    shuttingDown,
    timestamp: new Date().toISOString(),
  });
});

app.get('/health/ready', async (req, res) => {
  // Security hardening: readiness reflects dependency health, not just process uptime.
  const mongoHealth = getMongoHealth();
  const mongoReady = mongoHealth.connected;
  const mongoPoolExhausted = mongoHealth.pool?.poolExhausted === true;
  const rateLimiterRedis = getRateLimiterRedisStatus();
  const queueRuntime = getQueueRuntimeStatus();
  const lockRuntime = getOpsLockRuntimeStatus();
  const cacheRuntime = getCacheRuntimeStatus();
  const redisManager = getRedisManagerStatus();
  const dispatchStatus = getDispatchSchedulerStatus();
  const opsStatus = getOpsRuntimeStatus();
  const financeStatus = getFinanceCronStatus();
  const trackingStatus = getTrackingGatewayStatus();
  const pricingStatus = getPricingGatewayStatus();
  const loggerHealth = getLoggerHealth();
  const invoiceQueue = getInvoiceQueueWorkerStatus();
  const otelHealth = getOtelHealth();

  const redisRequired = process.env.NODE_ENV === 'production'
    && String(process.env.REDIS_REQUIRED || 'true').trim().toLowerCase() === 'true';
  const redisHealthy = !redisRequired || (
    redisManager.connected
    && rateLimiterRedis.connected
    && queueRuntime.redisAvailable
    && lockRuntime.redisAvailable
    && cacheRuntime.redisAvailable
    && trackingStatus.redisReady
  );
  const ready = !shuttingDown && mongoReady && !mongoPoolExhausted && redisHealthy;
  const statusCode = ready ? 200 : 503;

  res.status(statusCode).json({
    status: ready ? 'ready' : 'not_ready',
    service: 'abzora-backend',
    timestamp: new Date().toISOString(),
    checks: {
      mongoReady,
      mongoPoolExhausted,
      redisRequired,
      redisHealthy,
      redisManager,
      shuttingDown,
      mongoHealth,
      rateLimiterRedis,
      queueRuntime,
      lockRuntime,
      cacheRuntime,
      dispatchStatus,
      financeStatus,
      trackingStatus,
      pricingStatus,
      telemetry: {
        tracing: {
          asyncContextEnabled: true,
          redisTraceBacklog: Number(redisManager.reconnecting ? 1 : 0),
        },
        logger: loggerHealth,
        exporter: otelHealth.exporter,
        openTelemetry: otelHealth,
      },
      invoiceQueue,
      opsStatus: {
        detectionRunning: opsStatus.detectionRunning,
        escalationRunning: opsStatus.escalationRunning,
        metricsHourlyRunning: opsStatus.metricsHourlyRunning,
        metricsDailyRunning: opsStatus.metricsDailyRunning,
        workerRunning: Boolean(opsStatus.worker?.running),
      },
    },
  });
});

app.get(
  '/health/outbox-worker',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  getOutboxWorkerHealth,
);

app.get(
  '/metrics/outbox',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  getOutboxMetrics,
);

app.get(
  '/health/webhook-ingest',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  getWebhookIngestHealth,
);

app.get(
  '/metrics/webhook-ingest',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  getWebhookIngestMetrics,
);

app.get(
  '/metrics/telemetry',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  (req, res) => {
    res.status(200).json({
      success: true,
      data: {
        logger: getLoggerHealth(),
        redisTracing: getRedisManagerStatus(),
        openTelemetry: getOtelHealth(),
        metrics: telemetryMetrics.snapshot(),
      },
    });
  },
);

app.get(
  '/health/queue',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  (req, res) => {
    res.status(200).json({
      success: true,
      data: bullMqHealth(),
    });
  },
);

app.get(
  '/health/storage',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = await getStorageHealth();
      res.status(data.status === 'ok' ? 200 : 503).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/health/email',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = await getEmailHealth();
      res.status(data.status === 'ok' ? 200 : 503).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/health/invoices',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = await getInvoiceHealth();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/metrics/invoices/queues',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const data = await getQueueHealth();
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
);

app.get(
  '/metrics/invoices/prometheus',
  outboxMetricsLimiter,
  authMiddleware,
  requireAdmin,
  async (req, res, next) => {
    try {
      const body = await renderInvoicePrometheusMetrics();
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.status(200).send(body);
    } catch (error) {
      next(error);
    }
  },
);

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'ABZORA backend is running.',
    docs: {
      health: '/health',
      auth: '/auth/me',
      products: '/products',
      stores: '/stores',
      orders: '/orders',
      finance: '/finance/overview',
      wallet: '/wallet/vendor',
      payouts: '/payouts/vendor/settle',
      trialHome: '/trial-home/me',
      aiSpecs: '/ai/specs',
      arGenerate: '/ar/generate',
      upload: '/upload',
      atelierCatalog: '/atelier/catalog',
      atelierQuote: '/atelier/quote',
      atelierCreate: '/orders/atelier',
      wardrobeSave: '/wardrobe/save',
      wardrobeList: '/wardrobe',
      wardrobeRecommend: '/wardrobe/recommend',
    },
  });
});

app.get('/verify/invoice/:invoiceId', verifyInvoicePublic);

app.use('/auth/test-user', accountCreationLimiter);
app.use('/auth', authLimiter, authRoutes);
app.use('/legal', legalRoutes);
app.get('/profile', authLimiter, authMiddleware, me);
app.get('/eta/:orderId', authMiddleware, getOrderEta);
app.use('/user', authLimiter, userRoutes);
app.use('/products', productRoutes);
app.use('/stores', storeRoutes);
app.use('/orders/create-razorpay-order', paymentLimiter);
app.use('/orders/verify-payment', paymentLimiter);
app.use('/orders', orderLimiter, orderRoutes);
app.use('/payment', paymentLimiter, paymentRoutes);
app.use('/vendor/withdraw', withdrawalLimiter);
app.use('/rider/withdraw', withdrawalLimiter);
app.use('/upload', uploadLimiter, uploadRoutes);
app.use('/wishlist', wishlistRoutes);
app.use('/cards', cardRoutes);
app.use('/chats', chatLimiter, chatRoutes);
app.use('/support', supportLimiter, supportRoutes);
app.use('/ai', aiLimiter, aiRoutes);
app.use('/admin', adminLimiter, authMiddleware, requireAdmin, adminRoutes);
app.use('/vendor', authMiddleware, requireVendor, vendorRoutes);
app.use('/rider', authMiddleware, requireRider, riderRoutes);
app.use('/kyc', kycRoutes);
app.use('/reviews', reviewRoutes);
app.use('/bookings', bookingRoutes);
app.use('/banners', bannerRoutes);
app.use('/home-visuals', homeVisualRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/outfits', aiLimiter, outfitRoutes);
app.use('/', socialLimiter, socialRoutes);
app.use('/finance', adminLimiter, authMiddleware, financeRoutes);
app.use('/wallet', withdrawalLimiter, authMiddleware, walletRoutes);
app.use('/payouts', adminLimiter, authMiddleware, requireAdmin, payoutRoutes);
app.use('/ar', arRoutes);
app.use('/trial-home', orderLimiter, trialHomeRoutes);
app.use('/cta-decision', ctaRoutes);
app.use('/experience-config', experienceRoutes);
app.use('/experience', experienceRoutes);
app.use('/ml', aiLimiter, mlRoutes);
app.use('/analytics', supportLimiter, analyticsRoutes);
app.use('/', logisticsRoutes);
app.use('/dispatch', dispatchRoutes);
app.use('/tracking', trackingRoutes);
app.use('/atelier', orderLimiter, atelierRoutes);
app.use('/ops', adminLimiter, authMiddleware, requireAdmin, opsRoutes);
app.use('/fleet', adminLimiter, fleetRoutes);
app.use('/wardrobe', wardrobeRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/debug', adminLimiter, authMiddleware, requireAdmin, debugRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/admin', adminInvoiceRoutes);
app.use('/files/invoices', express.static(require('path').join(__dirname, 'storage', 'invoices')));

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

app.use(sentry.errorHandler());

app.use((error, req, res, next) => {
  sentry.captureException(error, {
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.uid || req.dbUser?.uid || '',
  });
  logSecurityError('backend_error', {
    requestId: req.requestId,
    traceId: req.traceId,
    spanId: req.spanId,
    path: req.originalUrl,
    method: req.method,
    ip: clientIp(req),
    message: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });
  const status = error.statusCode || error.status || 500;
  res.status(status).json({
    success: false,
    message: error.message || 'Internal server error.',
  });
});

async function startServer() {
  try {
    await startOpenTelemetry();
    await connectDB();
    initializeFirebase();
    scheduleFinanceCrons();
    startDispatchScheduler();
    startOpsRuntime();
    startInvoiceQueueWorker();
    try {
      await startInvoiceBullMqWorkers();
      startInvoiceQueueSelfHealing();
    } catch (error) {
      logger.error('invoice_bullmq_start_failed', {
        module: 'server',
        message: error?.message || String(error),
      });
    }
    // Security hardening: durable outbox replay worker recovers missed side effects
    // after crashes/restarts and supports horizontal multi-worker processing.
    if (String(process.env.PAYMENT_OUTBOX_WORKER_ENABLED || 'true').trim().toLowerCase() === 'true') {
      startPaymentOutboxWorker({
        pollIntervalMs: Number(process.env.PAYMENT_OUTBOX_POLL_INTERVAL_MS || 1000),
        batchSize: Number(process.env.PAYMENT_OUTBOX_BATCH_SIZE || 5),
        leaseMs: Number(process.env.PAYMENT_OUTBOX_LEASE_MS || 15000),
        maxAttemptsDefault: Number(process.env.PAYMENT_OUTBOX_MAX_ATTEMPTS || 8),
        cleanupEveryMs: Number(process.env.PAYMENT_OUTBOX_CLEANUP_EVERY_MS || 600000),
        completedRetentionMs: Number(process.env.PAYMENT_OUTBOX_COMPLETED_RETENTION_MS || 259200000),
      });
    }
    if (String(process.env.PAYMENT_WEBHOOK_INGEST_WORKER_ENABLED || 'true').trim().toLowerCase() === 'true') {
      startPaymentWebhookIngestWorker({
        processor: processPaymentWebhookIngestEvent,
        pollIntervalMs: Number(process.env.PAYMENT_WEBHOOK_INGEST_POLL_INTERVAL_MS || 500),
        batchSize: Number(process.env.PAYMENT_WEBHOOK_INGEST_BATCH_SIZE || 20),
        concurrency: Number(process.env.PAYMENT_WEBHOOK_INGEST_CONCURRENCY || 6),
        leaseMs: Number(process.env.PAYMENT_WEBHOOK_INGEST_LEASE_MS || 15000),
        maxAttemptsDefault: Number(process.env.PAYMENT_WEBHOOK_INGEST_MAX_ATTEMPTS || 8),
        cleanupEveryMs: Number(process.env.PAYMENT_WEBHOOK_INGEST_CLEANUP_EVERY_MS || 600000),
        retentionMs: Number(process.env.PAYMENT_WEBHOOK_INGEST_RETENTION_MS || 172800000),
      });
    }
    httpServer = http.createServer(app);
    attachTrackingGateway(httpServer);
    attachPricingGateway(httpServer);
    httpServer.listen(port, host, () => {
      logger.info('backend_started', { module: 'server', host, port });
    });

    // Do not block port binding on Redis warmup; readiness endpoint gates traffic.
    Promise.resolve()
      .then(async () => {
        await warmupRedisClient();
        await Promise.all([
          initializeRateLimiterRedis(),
          initializeOpsQueueRedis(),
          initializeOpsLockRedis(),
          initializeRedisCacheClient(),
          initializeTrackingRedis(),
        ]);
        const redisConfig = getRedisConfigSummary();
        logger.info('startup_redis_config', { module: 'server', redisConfig });
        logger.info('startup_redis_subsystems', { module: 'server', subsystems: {
          rateLimiterRedis: getRateLimiterRedisStatus(),
          lockRuntime: getOpsLockRuntimeStatus(),
          queueRuntime: getQueueRuntimeStatus(),
          cacheRuntime: getCacheRuntimeStatus(),
          trackingStatus: getTrackingGatewayStatus(),
        } });
      })
      .catch((error) => {
        logger.error('startup_redis_initialization_failed', { module: 'server', message: error?.message || String(error) });
      });
  } catch (error) {
    logger.error('backend_start_failed', { module: 'server', message: error?.message || String(error) });
    process.exit(1);
  }
}

startServer();

async function gracefulShutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('graceful_shutdown_started', { module: 'server', signal });

  const forceExitTimer = setTimeout(() => {
    logger.error('graceful_shutdown_timeout', { module: 'server' });
    process.exit(1);
  }, Number(process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS || 30000));
  forceExitTimer.unref?.();

  try {
    if (httpServer) {
      await new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    }
    await Promise.all([
      stopPaymentOutboxWorker(),
      stopPaymentWebhookIngestWorker(),
      closeTrackingGateway(),
      Promise.resolve(closePricingGateway()),
    ]);
    stopDispatchScheduler();
    stopFinanceCrons();
    stopOpsRuntime();
    stopInvoiceQueueWorker();
    stopInvoiceQueueSelfHealing();
    await closeBullMq();
    await Promise.all([
      closeRateLimiterRedisClient(),
      closeQueueClient(),
      closeOpsLockClient(),
      closeRedisCacheClient(),
    ]);
    await closeRedisClientManager();
    await shutdownOpenTelemetry();
    await closeDBConnection();
    clearTimeout(forceExitTimer);
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    logger.error('graceful_shutdown_failed', { module: 'server', message: error?.message || String(error) });
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  gracefulShutdown('SIGINT');
});

process.on('unhandledRejection', (reason) => {
  logger.error('process_unhandled_rejection', {
    module: 'server',
    message: reason?.message || String(reason),
  });
});

process.on('uncaughtException', (error) => {
  logger.error('process_uncaught_exception', {
    module: 'server',
    message: error?.message || String(error),
    stack: process.env.NODE_ENV === 'production' ? '' : String(error?.stack || ''),
  });
});



