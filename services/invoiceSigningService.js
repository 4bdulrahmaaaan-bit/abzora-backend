const crypto = require('crypto');

function getInvoiceSigningSecret() {
  const secret = String(process.env.INVOICE_SIGNING_SECRET || '').trim();
  if (!secret) {
    throw new Error('INVOICE_SIGNING_SECRET is required.');
  }
  return secret;
}

function timingSafeHexEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function buildSignedToken({ invoiceId, userId, role, expiresAt, version = 'v1' }) {
  const payload = `${invoiceId}.${userId || 'anon'}.${role || 'customer'}.${expiresAt}.${version}`;
  const signature = crypto.createHmac('sha256', getInvoiceSigningSecret()).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length < 6) return { valid: false, reason: 'format' };

  const [invoiceId, userId, role, expiresAt, version, signature] = parts;
  const payload = `${invoiceId}.${userId}.${role}.${expiresAt}.${version}`;
  let expected;
  try {
    expected = crypto.createHmac('sha256', getInvoiceSigningSecret()).update(payload).digest('hex');
  } catch (error) {
    return { valid: false, reason: 'secret_missing' };
  }
  if (!timingSafeHexEqual(expected, signature)) return { valid: false, reason: 'signature' };
  if (Date.now() > Number(expiresAt)) return { valid: false, reason: 'expired' };

  return {
    valid: true,
    invoiceId,
    userId,
    role,
    version,
    expiresAt: Number(expiresAt),
  };
}

module.exports = {
  buildSignedToken,
  verifySignedToken,
};
