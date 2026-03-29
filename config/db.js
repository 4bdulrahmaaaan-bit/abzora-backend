const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) {
    return mongoose.connection;
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri || mongoUri.includes('username:password') || mongoUri.includes('cluster.mongodb.net/abzora')) {
    throw new Error('MONGO_URI is missing or still using the placeholder Atlas connection string.');
  }

  await mongoose.connect(mongoUri, {
    autoIndex: process.env.NODE_ENV !== 'production',
  });

  isConnected = true;
  console.log('MongoDB connected');
  return mongoose.connection;
}

module.exports = connectDB;
