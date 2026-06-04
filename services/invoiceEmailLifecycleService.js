const crypto = require('crypto');
const InvoiceEmailLog = require('../models/InvoiceEmailLog');
const InvoiceEmailSuppression = require('../models/InvoiceEmailSuppression');
const { logInvoiceAudit } = require('./invoiceAuditService');

function verifyResendWebhookSignature(rawBody, signatureHeader) {
  const secret = String(process.env.RESEND_WEBHOOK_SECRET || '').trim();
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const actual = String(signatureHeader || '').trim();
  if (!actual) return false;
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

async function upsertSuppression({ email, reason, providerMessageId, notes = '' }) {
  if (!email) return null;
  return InvoiceEmailSuppression.findOneAndUpdate(
    { email: String(email).trim().toLowerCase() },
    {
      $set: {
        reason: reason || 'bounce',
        source: 'resend_webhook',
        providerMessageId: providerMessageId || '',
        active: true,
        notes,
      },
    },
    { upsert: true, new: true },
  );
}

async function isSuppressed(email) {
  if (!email) return false;
  const hit = await InvoiceEmailSuppression.findOne({
    email: String(email).trim().toLowerCase(),
    active: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).lean();
  return Boolean(hit);
}

async function processResendEvent({ event, reqLike }) {
  const messageId = String(event?.data?.email_id || event?.data?.id || '').trim();
  const email = String(event?.data?.to?.[0] || event?.data?.to || '').trim().toLowerCase();
  const type = String(event?.type || '').trim().toLowerCase();
  if (!messageId && !email) return { processed: false, reason: 'missing identifiers' };

  const query = messageId ? { providerMessageId: messageId } : { email };
  const log = await InvoiceEmailLog.findOne(query).sort({ createdAt: -1 });
  if (!log) return { processed: false, reason: 'email log not found' };
  const eventId = String(event?.data?.id || event?.id || '').trim();
  const processedEventIds = Array.isArray(log.payload?.processedWebhookEventIds)
    ? log.payload.processedWebhookEventIds
    : [];
  if (eventId && processedEventIds.includes(eventId)) {
    return { processed: true, duplicate: true, status: log.status };
  }

  log.lastWebhookEvent = type;
  if (type.includes('delivered')) log.status = 'delivered';
  if (type.includes('bounced') || type.includes('bounce')) {
    log.status = 'bounced';
    log.bouncedAt = new Date();
    await upsertSuppression({ email: log.email, reason: 'bounce', providerMessageId: messageId });
  }
  if (type.includes('complained') || type.includes('complaint')) {
    log.status = 'complained';
    log.complainedAt = new Date();
    await upsertSuppression({ email: log.email, reason: 'complaint', providerMessageId: messageId });
  }
  log.payload = {
    ...(log.payload || {}),
    processedWebhookEventIds: eventId
      ? [...processedEventIds.slice(-99), eventId]
      : processedEventIds,
  };
  await log.save();

  await logInvoiceAudit({
    req: reqLike,
    action: 'emailWebhookProcessed',
    invoiceId: log.invoiceId,
    payload: { emailLogId: String(log._id), webhookType: type, providerMessageId: messageId },
  });
  return { processed: true, status: log.status };
}

module.exports = {
  verifyResendWebhookSignature,
  processResendEvent,
  isSuppressed,
  upsertSuppression,
};
