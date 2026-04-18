const { URL } = require('url');

const initializeFirebase = require('../config/firebase');
const User = require('../models/User');
const { localPricingBus, PRICING_EVENT_CHANNEL, getPricingConfig } = require('./pricingConfigService');

let wsServer = null;
const subscribers = new Set();

async function decodeSocketUser(token) {
  if (!token) {
    return null;
  }
  const admin = initializeFirebase();
  if (!admin) {
    return null;
  }
  const decoded = await admin.auth().verifyIdToken(token);
  const user = await User.findOne({
    $or: [
      { firebaseUid: decoded.uid },
      { uid: decoded.uid },
      ...(decoded.email ? [{ email: decoded.email }] : []),
    ],
  }).lean();
  if (!user) {
    return null;
  }
  return user;
}

function extractBearerToken(requestUrl, requestHeaders) {
  const queryToken = String(requestUrl.searchParams.get('token') || '').trim();
  if (queryToken) {
    return queryToken;
  }
  const authHeader = String(requestHeaders?.authorization || '').trim();
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const ws of subscribers) {
    if (ws.readyState !== 1) {
      subscribers.delete(ws);
      continue;
    }
    ws.send(message);
  }
}

function attachPricingGateway(server) {
  if (wsServer) {
    return wsServer;
  }
  // eslint-disable-next-line global-require
  const { WebSocketServer } = require('ws');
  wsServer = new WebSocketServer({ server, path: '/ws/pricing' });

  localPricingBus.on(PRICING_EVENT_CHANNEL, (payload) => {
    broadcast(payload);
  });

  wsServer.on('connection', async (ws, request) => {
    try {
      const requestUrl = new URL(request.url, `http://${request.headers.host}`);
      const token = extractBearerToken(requestUrl, request.headers);
      const user = await decodeSocketUser(token);
      const allowedRoles = new Set(['admin', 'super_admin']);
      if (!user || !allowedRoles.has(String(user.role || '').trim().toLowerCase())) {
        ws.close(1008, 'Admin access required');
        return;
      }
      subscribers.add(ws);
      ws.send(JSON.stringify({
        eventType: 'pricing_config_snapshot',
        config: await getPricingConfig(),
        timestamp: new Date().toISOString(),
      }));
      ws.on('close', () => {
        subscribers.delete(ws);
      });
    } catch (_) {
      ws.close(1011, 'Pricing gateway unavailable');
    }
  });

  return wsServer;
}

module.exports = {
  attachPricingGateway,
};
