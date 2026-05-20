const crypto = require('crypto');
const InvoiceAuditLog = require('../models/InvoiceAuditLog');

function hashEntry(entry) {
  return crypto.createHash('sha256').update(JSON.stringify(entry)).digest('hex');
}

async function logInvoiceAudit({ req, action, invoiceId = null, creditNoteId = null, payload = {} }) {
  const base = {
    invoiceId,
    creditNoteId,
    action,
    actorId: req?.user?.uid || '',
    actorRole: req?.user?.role || '',
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || '',
    userAgent: req?.headers?.['user-agent'] || '',
    deviceMetadata: {
      platform: req?.headers?.['sec-ch-ua-platform'] || '',
      mobile: req?.headers?.['sec-ch-ua-mobile'] || '',
    },
    payload,
  };
  const immutableHash = hashEntry(base);
  await InvoiceAuditLog.create({ ...base, immutableHash });
}

module.exports = {
  logInvoiceAudit,
};
