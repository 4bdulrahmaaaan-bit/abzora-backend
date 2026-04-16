const express = require('express');
const mongoose = require('mongoose');

const router = express.Router();

function isAuthorized(req) {
  const expectedKey = (process.env.DEBUG_WRITE_KEY || '').trim();
  if (!expectedKey) {
    return false;
  }
  const providedKey =
    (req.headers['x-debug-key'] || req.query.debugKey || '').toString().trim();
  return providedKey === expectedKey;
}

router.post('/create-test-doc', async (req, res, next) => {
  try {
    if (!process.env.DEBUG_WRITE_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Debug endpoint disabled. Set DEBUG_WRITE_KEY to enable.',
      });
    }

    if (!isAuthorized(req)) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized debug request.',
      });
    }

    const db = mongoose.connection.db;
    if (!db) {
      return res.status(503).json({
        success: false,
        message: 'Database connection is not ready.',
      });
    }

    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const doc = {
      type: 'debug_test_write',
      source: 'debug/create-test-doc',
      timestamp: new Date(),
      requestPayload: payload,
      appName: process.env.APP_NAME || 'abzora-backend',
      env: process.env.NODE_ENV || 'development',
    };

    const result = await db.collection('debug_test_writes').insertOne(doc);
    return res.status(201).json({
      success: true,
      message: 'Debug test document created.',
      data: {
        insertedId: result.insertedId,
        database: db.databaseName,
        collection: 'debug_test_writes',
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;

