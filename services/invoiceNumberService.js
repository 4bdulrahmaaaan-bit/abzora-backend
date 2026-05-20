const InvoiceCounter = require('../models/InvoiceCounter');

async function nextInvoiceNumber(date = new Date()) {
  const year = date.getUTCFullYear();
  const key = `ABZ-${year}`;
  const doc = await InvoiceCounter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return `${key}-${String(doc.seq).padStart(6, '0')}`;
}

async function nextCreditNoteNumber(date = new Date()) {
  const year = date.getUTCFullYear();
  const key = `CN-${year}`;
  const doc = await InvoiceCounter.findOneAndUpdate({ key }, { $inc: { seq: 1 } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return `${key}-${String(doc.seq).padStart(6, '0')}`;
}

function buildInvoiceSnapshotHash(snapshot) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}

module.exports = {
  nextInvoiceNumber,
  nextCreditNoteNumber,
  buildInvoiceSnapshotHash,
};
