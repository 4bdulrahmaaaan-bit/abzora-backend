const { queueNames, registerWorker, addJob } = require('./bullMqService');
const { processPaymentWebhookIngestEvent } = require('../controllers/paymentController');

async function queueWebhookEvent(event, payload, rawBody, signature) {
  return addJob(queueNames.webhookIngest, 'process-webhook', {
    event,
    payload,
    rawBody: rawBody.toString('base64'),
    signature
  }, {
    attempts: 8,
    backoff: { type: 'exponential', delay: 1000 },
  });
}

function startWebhookWorker() {
  return registerWorker(queueNames.webhookIngest, async (job) => {
    const { event, payload } = job.data;
    
    // We wrap it in a mock doc to match processPaymentWebhookIngestEvent signature
    const eventDoc = {
      ingestId: `bullmq-${job.id}`,
      event,
      payload
    };

    return processPaymentWebhookIngestEvent(eventDoc);
  }, { concurrency: 5 });
}

module.exports = {
  queueWebhookEvent,
  startWebhookWorker
};
