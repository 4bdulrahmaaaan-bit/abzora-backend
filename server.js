require('dotenv').config();

const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
require('./config/cloudinary');
const initializeFirebase = require('./config/firebase');
const {
  createCorsOptions,
  createRateLimiter,
  securityHeaders,
} = require('./middleware/securityMiddleware');
const { scheduleFinanceCrons } = require('./services/financeCronService');

const authRoutes = require('./routes/authRoutes');
const productRoutes = require('./routes/productRoutes');
const storeRoutes = require('./routes/storeRoutes');
const orderRoutes = require('./routes/orderRoutes');
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
const categoryRoutes = require('./routes/category.routes');
const outfitRoutes = require('./routes/outfitRoutes');
const webhookRoutes = require('./routes/webhookRoutes');

const app = express();
const port = Number(process.env.PORT || 5000);
const host = process.env.HOST || '0.0.0.0';
app.set('trust proxy', 1);

app.use(cors(createCorsOptions()));
app.use(securityHeaders);
app.use('/webhooks/razorpayx', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 80,
  message: 'Too many authentication requests. Please wait and try again.',
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
      upload: '/upload',
    },
  });
});

app.use('/auth', authLimiter, authRoutes);
app.use('/products', productRoutes);
app.use('/stores', storeRoutes);
app.use('/orders/create-razorpay-order', paymentLimiter);
app.use('/orders/verify-payment', paymentLimiter);
app.use('/orders', orderLimiter, orderRoutes);
app.use('/upload', uploadLimiter, uploadRoutes);
app.use('/wishlist', wishlistRoutes);
app.use('/cards', cardRoutes);
app.use('/chats', chatRoutes);
app.use('/support', supportLimiter, supportRoutes);
app.use('/ai', aiRoutes);
app.use('/admin', adminLimiter, adminRoutes);
app.use('/vendor', vendorRoutes);
app.use('/rider', riderRoutes);
app.use('/kyc', kycRoutes);
app.use('/reviews', reviewRoutes);
app.use('/bookings', bookingRoutes);
app.use('/banners', bannerRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/outfits', outfitRoutes);
app.use('/webhooks', webhookRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

app.use((error, req, res, next) => {
  console.error('Backend error:', error);
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
    app.listen(port, host, () => {
      console.log(`ABZORA backend running on ${host}:${port}`);
    });
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

startServer();
