const { EventEmitter } = require('events');
const { URL } = require('url');

const initializeFirebase = require('../config/firebase');
const DeliveryTask = require('../models/DeliveryTask');
const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');

const localBus = new EventEmitter();
localBus.setMaxListeners(1000);

let redisPub = null;
let redisSub = null;
let redisReady = false;
let wsServer = null;

const REDIS_CHANNEL = 'abzora:tracking:events';
const rooms = new Map(); // room -> Set(ws)
const sockets = new Map(); // ws -> { rooms:Set<string>, uid, role, user }

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function roomName(type, id) {
  return `${type}:${String(id || '').trim()}`;
}

function addToRoom(room, ws) {
  if (!rooms.has(room)) {
    rooms.set(room, new Set());
  }
  rooms.get(room).add(ws);
}

function removeFromRoom(room, ws) {
  const group = rooms.get(room);
  if (!group) return;
  group.delete(ws);
  if (group.size === 0) {
    rooms.delete(room);
  }
}

function removeSocket(ws) {
  const state = sockets.get(ws);
  if (!state) return;
  for (const room of state.rooms) {
    removeFromRoom(room, ws);
  }
  sockets.delete(ws);
}

function broadcastToRooms(targetRooms = [], payload = {}) {
  const delivered = new Set();
  for (const room of targetRooms) {
    const group = rooms.get(room);
    if (!group) continue;
    for (const ws of group) {
      if (delivered.has(ws)) continue;
      if (ws.readyState !== 1) continue;
      ws.send(JSON.stringify(payload));
      delivered.add(ws);
    }
  }
}

async function ensureRedisPubSub() {
  if (redisReady || process.env.REDIS_DISABLED === 'true') {
    return;
  }
  const redisUrl = process.env.REDIS_URL || '';
  if (!redisUrl) return;
  try {
    // eslint-disable-next-line global-require
    const { createClient } = require('redis');
    redisPub = createClient({ url: redisUrl });
    redisSub = createClient({ url: redisUrl });
    await redisPub.connect();
    await redisSub.connect();
    await redisSub.subscribe(REDIS_CHANNEL, (raw) => {
      const event = safeJsonParse(raw);
      if (!event) return;
      const targetRooms = Array.isArray(event.rooms) ? event.rooms : [];
      broadcastToRooms(targetRooms, event.payload || event);
    });
    redisReady = true;
  } catch (_) {
    redisPub = null;
    redisSub = null;
    redisReady = false;
  }
}

function inferRooms(event = {}) {
  const result = new Set();
  if (event.orderId) {
    result.add(roomName('order', event.orderId));
  }
  if (event.riderId) {
    result.add(roomName('rider', event.riderId));
  }
  if (event.userId) {
    result.add(roomName('user', event.userId));
  }
  if (event.taskId) {
    result.add(roomName('task', event.taskId));
  }
  if (Array.isArray(event.extraRooms)) {
    for (const room of event.extraRooms) {
      if (room) result.add(String(room));
    }
  }
  return [...result];
}

async function publishTrackingEvent(event = {}) {
  const payload = {
    eventType: event.eventType || 'tracking_event',
    orderId: event.orderId || '',
    riderId: event.riderId || '',
    userId: event.userId || '',
    taskId: event.taskId || '',
    data: event.data || {},
    timestamp: new Date().toISOString(),
  };
  const targetRooms = inferRooms(event);

  if (redisReady && redisPub) {
    await redisPub.publish(
      REDIS_CHANNEL,
      JSON.stringify({
        rooms: targetRooms,
        payload,
      }),
    );
  } else {
    broadcastToRooms(targetRooms, payload);
    localBus.emit(REDIS_CHANNEL, { rooms: targetRooms, payload });
  }
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
      ...(decoded.phone_number ? [{ phone: decoded.phone_number }] : []),
    ],
  });
  return {
    uid: decoded.uid,
    role: String(user?.role || decoded.role || 'customer').trim().toLowerCase(),
    user,
  };
}

async function canJoinRoom(state, room) {
  const [type, id] = String(room || '').split(':');
  const entityId = String(id || '').trim();
  if (!type || !entityId || !state?.uid) {
    return false;
  }

  if (state.role === 'admin' || state.role === 'super_admin') {
    return true;
  }

  if (type === 'user') {
    return entityId === state.uid;
  }
  if (type === 'rider') {
    return state.role === 'rider' && entityId === state.uid;
  }

  if (type === 'order') {
    const order = await Order.findById(entityId).select('userId riderId storeId').lean();
    if (!order) return false;
    if (state.role === 'rider') {
      return String(order.riderId || '') === state.uid;
    }
    if (state.role === 'customer' || state.role === 'user') {
      return String(order.userId || '') === state.uid;
    }
    if (state.role === 'vendor') {
      const store = await Store.findById(order.storeId).select('ownerId').lean();
      return String(store?.ownerId || '') === state.uid;
    }
    return false;
  }

  if (type === 'task') {
    const task = await DeliveryTask.findById(entityId).select('userId riderId vendorId').lean();
    if (!task) return false;
    if (state.role === 'rider') {
      return String(task.riderId || '') === state.uid;
    }
    if (state.role === 'customer' || state.role === 'user') {
      return String(task.userId || '') === state.uid;
    }
    if (state.role === 'vendor') {
      return String(task.vendorId || '') === state.uid;
    }
    return false;
  }

  return false;
}

function closeUnauthorizedSocket(ws, message = 'Unauthorized socket') {
  try {
    ws.send(JSON.stringify({ eventType: 'error', message }));
  } catch (_) {
    // no-op
  }
  ws.close(1008, message);
}

function attachTrackingGateway(httpServer) {
  // eslint-disable-next-line global-require
  const { WebSocketServer } = require('ws');
  wsServer = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (requestUrl.pathname !== '/tracking/ws') {
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(request, socket, head, (ws) => {
      wsServer.emit('connection', ws, request);
    });
  });

  wsServer.on('connection', async (ws, request) => {
    try {
      const requestUrl = new URL(request.url, 'http://localhost');
      const token = extractBearerToken(requestUrl, request.headers || {});
      const authState = await decodeSocketUser(token);

      if (!authState?.uid) {
        closeUnauthorizedSocket(ws, 'Socket authentication failed.');
        return;
      }

      const state = {
        rooms: new Set(),
        uid: authState.uid,
        role: authState.role,
        user: authState.user,
      };
      sockets.set(ws, state);

      const guardedJoin = async (room) => {
        if (!room) return false;
        const allowed = await canJoinRoom(state, room);
        if (!allowed) {
          return false;
        }
        state.rooms.add(room);
        addToRoom(room, ws);
        return true;
      };

      const queryJoin = [
        roomName('rider', requestUrl.searchParams.get('riderId') || ''),
        roomName('user', requestUrl.searchParams.get('userId') || ''),
        roomName('order', requestUrl.searchParams.get('orderId') || ''),
        roomName('task', requestUrl.searchParams.get('taskId') || ''),
      ];
      for (const room of queryJoin) {
        if (!room.endsWith(':')) {
          // eslint-disable-next-line no-await-in-loop
          await guardedJoin(room);
        }
      }

      ws.send(JSON.stringify({
        eventType: 'connected',
        role: state.role,
        uid: state.uid,
        rooms: [...state.rooms],
        timestamp: new Date().toISOString(),
      }));

      ws.on('message', async (message) => {
        const payload = safeJsonParse(message.toString());
        if (!payload) return;
        if (payload.action === 'join' && payload.room) {
          const joined = await guardedJoin(String(payload.room));
          if (!joined) {
            ws.send(JSON.stringify({
              eventType: 'join_denied',
              room: String(payload.room),
              message: 'Room access denied',
              timestamp: new Date().toISOString(),
            }));
          }
        } else if (payload.action === 'leave' && payload.room) {
          const room = String(payload.room);
          state.rooms.delete(room);
          removeFromRoom(room, ws);
        }
      });

      ws.on('close', () => removeSocket(ws));
      ws.on('error', () => removeSocket(ws));
    } catch (_) {
      closeUnauthorizedSocket(ws, 'Socket handshake failed.');
      removeSocket(ws);
    }
  });

  ensureRedisPubSub();
  if (!redisReady) {
    localBus.on(REDIS_CHANNEL, ({ rooms: targetRooms, payload }) => {
      broadcastToRooms(targetRooms, payload);
    });
  }
}

module.exports = {
  attachTrackingGateway,
  publishTrackingEvent,
};
