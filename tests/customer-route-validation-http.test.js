const http = require('http');
const express = require('express');

const { validateBody, validateQuery } = require('../validation/schemaValidator');
const {
  chatSendMessageSchema,
  socialFeedQuerySchema,
  socialVoteSchema,
  supportMessagesQuerySchema,
  trackingLocationUpdateSchema,
} = require('../validation/schemas/customerSchemas');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

async function withServer(app, fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  const app = express();
  app.use(express.json());

  app.post('/tracking/location-update', validateBody(trackingLocationUpdateSchema), (_req, res) => res.status(200).json({ ok: true }));
  app.get('/support/chats/1/messages', validateQuery(supportMessagesQuerySchema), (_req, res) => res.status(200).json({ ok: true }));
  app.post('/chat/1/messages', validateBody(chatSendMessageSchema), (_req, res) => res.status(200).json({ ok: true }));
  app.get('/social/feed', validateQuery(socialFeedQuerySchema), (_req, res) => res.status(200).json({ ok: true }));
  app.post('/social/look/1/vote', validateBody(socialVoteSchema), (_req, res) => res.status(200).json({ ok: true }));

  await withServer(app, async (baseUrl) => {
    const badTracking = await requestJson(baseUrl, 'POST', '/tracking/location-update', { latitude: 10 });
    assert(badTracking.status === 400, `expected tracking schema 400, got ${badTracking.status}`);

    const badSupportQ = await requestJson(baseUrl, 'GET', '/support/chats/1/messages?limit=5000', null);
    assert(badSupportQ.status === 400, `expected support query 400, got ${badSupportQ.status}`);

    const badChatBody = await requestJson(baseUrl, 'POST', '/chat/1/messages', { text: '' });
    assert(badChatBody.status === 400, `expected chat schema 400, got ${badChatBody.status}`);

    const badSocialQ = await requestJson(baseUrl, 'GET', '/social/feed?limit=100', null);
    assert(badSocialQ.status === 400, `expected social query 400, got ${badSocialQ.status}`);

    const badVote = await requestJson(baseUrl, 'POST', '/social/look/1/vote', { reaction: 'love_it' });
    assert(badVote.status === 400, `expected vote schema 400, got ${badVote.status}`);
  });

  // eslint-disable-next-line no-console
  console.log('customer-route-validation-http: PASS');
}

main();

