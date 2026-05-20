const InvoiceReplayAuditLog = require('../models/InvoiceReplayAuditLog');
const { pauseQueue, resumeQueue, replayDeadLetter, queueNames } = require('./bullMqService');

async function logReplayAction({ req, queueName, action, payload = {}, jobId = '' }) {
  await InvoiceReplayAuditLog.create({
    queueName,
    jobId,
    action,
    actorId: req?.user?.uid || '',
    actorRole: req?.user?.role || '',
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || '',
    payload,
  });
}

async function pauseInvoiceQueue(req, queueName) {
  await pauseQueue(queueName);
  await logReplayAction({ req, queueName, action: 'queue_paused' });
  return { paused: true, queueName };
}

async function resumeInvoiceQueue(req, queueName) {
  await resumeQueue(queueName);
  await logReplayAction({ req, queueName, action: 'queue_resumed' });
  return { resumed: true, queueName };
}

async function replayInvoiceDlq(req, { limit = 25 } = {}) {
  await logReplayAction({ req, queueName: queueNames.deadLetter, action: 'replay_requested', payload: { limit } });
  const result = await replayDeadLetter({ limit });
  await logReplayAction({ req, queueName: queueNames.deadLetter, action: 'replay_executed', payload: result });
  return result;
}

module.exports = {
  pauseInvoiceQueue,
  resumeInvoiceQueue,
  replayInvoiceDlq,
  logReplayAction,
};
