require('dotenv').config();

const express = require('express');
const cors = require('cors');

const connectDB = require('./config/db');
require('./config/cloudinary');
const initializeFirebase = require('./config/firebase');

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

const app = express();
const port = Number(process.env.PORT || 5000);

app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN?.split(',').map((value) => value.trim()) || '*',
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.use('/auth', authRoutes);
app.use('/products', productRoutes);
app.use('/stores', storeRoutes);
app.use('/orders', orderRoutes);
app.use('/upload', uploadRoutes);
app.use('/wishlist', wishlistRoutes);
app.use('/cards', cardRoutes);
app.use('/chats', chatRoutes);
app.use('/support', supportRoutes);
app.use('/ai', aiRoutes);

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
    app.listen(port, () => {
      console.log(`ABZORA backend running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to start backend:', error);
    process.exit(1);
  }
}

startServer();
