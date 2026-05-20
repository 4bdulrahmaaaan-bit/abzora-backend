const crypto = require('crypto');

const SECRET = () => process.env.INVOICE_SIGNING_SECRET || process.env.JWT_SECRET || 'abzora-invoice-secret';

function buildSignedToken({ invoiceId, userId, role, expiresAt, version = 'v1' }) {
  const payload = `${invoiceId}.${userId || 'anon'}.${role || 'customer'}.${expiresAt}.${version}`;
  const signature = crypto.createHmac('sha256', SECRET()).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifySignedToken(token) {
  if (!token || typeof token !== 'string') return { valid: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length < 6) return { valid: false, reason: 'format' };

  const [invoiceId, userId, role, expiresAt, version, signature] = parts;
  const payload = `${invoiceId}.${userId}.${role}.${expiresAt}.${version}`;
  const expected = crypto.createHmac('sha256', SECRET()).update(payload).digest('hex');
  if (expected !== signature) return { valid: false, reason: 'signature' };
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
