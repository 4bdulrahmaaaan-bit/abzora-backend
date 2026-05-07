require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');

const connectDB = require('./config/db');
require('./config/cloudinary');
const initializeFirebase = require('./config/firebase');
const {
  createCorsOptions,
  createRateLimiter,
  enforceHttps,
  requestAuditLogger,
  requestContext,
  securityHeaders,
} = require('./middleware/securityMiddleware');
const authMiddleware = require('./middleware/authMiddleware');
const {
  requireAdmin,
  requireRider,
  requireVendor,
} = require('./middleware/authorizationMiddleware');
const { me } = require('./controllers/authController');
const { scheduleFinanceCrons } = require('./services/financeCronService');
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
const { attachTrackingGateway } = require('./services/trackingGateway');
const { attachPricingGateway } = require('./services/pricingGateway');
const { startDispatchScheduler } = require('./services/dispatchSchedulerService');
const { startOpsRuntime } = require('./services/opsRuntimeService');
const { getOrderEta } = require('./controllers/dispatchController');

const app = express();
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '0.0.0.0';
app.set('trust proxy', 1);

app.use(cors(createCorsOptions()));
app.use(requestContext);
app.use(requestAuditLogger);
app.use(enforceHttps);
app.use(securityHeaders);
app.use('/webhooks/razorpayx', express.raw({ type: 'application/json', limit: '1mb' }));
app.use('/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

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

const uploadLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: 'Too many upload requests. Please wait and try again.',
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

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'abzora-backend',
    timestamp: new Date().toISOString(),
  });
});

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

app.use('/auth/test-user', accountCreationLimiter);
app.use('/auth', authLimiter, authRoutes);
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
app.use('/chats', chatRoutes);
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
app.use('/', socialRoutes);
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
app.use('/debug', debugRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  logSecurityError('backend_error', {
    requestId: req.requestId,
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
    await connectDB();
    initializeFirebase();
    scheduleFinanceCrons();
    startDispatchScheduler();
    startOpsRuntime();
    const server = http.createServer(app);
    attachTrackingGateway(server);
    attachPricingGateway(server);
    server.listen(port, host, () => {
      console.log(`ABZORA backend running on ${host}:${port}`);
    });
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

startServer();

