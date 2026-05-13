const http = require('http');
const express = require('express');

const { requireRoles } = require('../middleware/authorizationMiddleware');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function requestJson(baseUrl, method, path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { raw: text };
  }
  return { status: response.status, data };
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

  const validateQuery = (validatorFn) => (req, res, next) => {
    if (validatorFn(req.query || {})) {
      return next();
    }
    return res.status(400).json({ success: false, message: 'Invalid query parameters.' });
  };
  const validateBody = (validatorFn) => (req, res, next) => {
    if (validatorFn(req.body || {})) {
      return next();
    }
    return res.status(400).json({ success: false, message: 'Invalid request payload.' });
  };

  app.get(
    '/q',
    validateQuery((query) => {
      const keys = Object.keys(query);
      if (!keys.every((key) => key === 'limit')) return false;
      if (!('limit' in query)) return true;
      const limit = Number(query.limit);
      return Number.isInteger(limit) && limit >= 1 && limit <= 10;
    }),
    (req, res) => res.status(200).json({ success: true }),
  );

  app.post(
    '/b',
    validateBody((body) => {
      const keys = Object.keys(body);
      if (!keys.every((key) => key === 'reason')) return false;
      return typeof body.reason === 'string' && body.reason.trim().length >= 3;
    }),
    (req, res) => res.status(200).json({ success: true }),
  );

  app.post(
    '/admin',
    (req, _res, next) => {
      if (req.headers['x-user'] === 'admin') {
        req.user = { uid: 'u1', role: 'admin', roles: { admin: true } };
      } else if (req.headers['x-user'] === 'vendor') {
        req.user = { uid: 'u2', role: 'vendor', roles: { vendor: true } };
      }
      next();
    },
    requireRoles('admin'),
    (_req, res) => res.status(200).json({ success: true }),
  );

  await withServer(app, async (baseUrl) => {
    const qBad = await requestJson(baseUrl, 'GET', '/q?limit=999&hack=true');
    assert(qBad.status === 400, `expected 400 for invalid query, got ${qBad.status}`);

    const bBad = await requestJson(baseUrl, 'POST', '/b', { reason: 'ok', extra: true });
    assert(bBad.status === 400, `expected 400 for invalid body, got ${bBad.status}`);

    const noAuth = await requestJson(baseUrl, 'POST', '/admin', {});
    assert(noAuth.status === 401, `expected 401 for missing auth, got ${noAuth.status}`);

    const wrongRole = await requestJson(baseUrl, 'POST', '/admin', {}, { 'x-user': 'vendor' });
    assert(wrongRole.status === 403, `expected 403 for wrong role, got ${wrongRole.status}`);
  });

  // eslint-disable-next-line no-console
  console.log('http-negative-security: PASS');
}

main();
