const crypto = require('crypto');
const mongoose = require('mongoose');

let indexesReady = false;

async function ensureWebhookLockIndexes() {
  if (indexesReady) {
    return;
  }
  const collection = mongoose.connection.collection('webhook_delivery_locks');
  await collection.createIndex({ key: 1 }, { unique: true, name: 'uniq_webhook_lock_key' });
  const ttlSeconds = Math.max(3600, Number(process.env.WEBHOOK_LOCK_TTL_SECONDS || 7 * 24 * 60 * 60));
  await collection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: ttlSeconds, name: 'ttl_webhook_lock_created_at' },
  );
  indexesReady = true;
}

async function claimWebhookDelivery({ source, rawBody, eventId, signature }) {
  const digest = crypto
    .createHash('sha256')
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || '')))
    .digest('hex');
  const key = `${source}:${String(eventId || '').trim() || digest}`;
  const now = new Date();
  try {
    await ensureWebhookLockIndexes();
    const collection = mongoose.connection.collection('webhook_delivery_locks');
    const result = await collection.updateOne(
      { key },
      {
        $setOnInsert: {
          key,
          source,
          eventId: String(eventId || '').trim(),
          signature: String(signature || '').trim(),
          digest,
          createdAt: now,
        },
        $set: { lastSeenAt: now },
      },
      { upsert: true },
    );
    return result?.upsertedCount === 1;
  } catch (_) {
    return false;
  }
}

module.exports = {
  claimWebhookDelivery,
};

