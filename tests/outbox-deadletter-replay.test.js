const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeReq(overrides = {}) {
  return {
    requestId: 'req-replay-1',
    params: { eventId: 'evt-1' },
    body: { reason: 'Manual recovery after downstream outage' },
    user: { uid: 'admin-1', role: 'admin', email: 'admin@example.com' },
    dbUser: { email: 'admin@example.com' },
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

function loadControllerWithStubs({ eventStore, allowedAdmin = true }) {
  const controllerPath = path.join(__dirname, '..', 'controllers', 'outboxReplayAdminController.js');
  const modelPath = path.join(__dirname, '..', 'models', 'PaymentOutboxEvent.js');
  const activityPath = path.join(__dirname, '..', 'models', 'AdminActivityLog.js');
  const authPath = path.join(__dirname, '..', 'controllers', 'authController.js');
  const auditPath = path.join(__dirname, '..', 'services', 'auditLogger.js');

  delete require.cache[require.resolve(controllerPath)];
  delete require.cache[require.resolve(modelPath)];
  delete require.cache[require.resolve(activityPath)];
  delete require.cache[require.resolve(authPath)];
  delete require.cache[require.resolve(auditPath)];

  require.cache[require.resolve(modelPath)] = {
    id: modelPath,
    filename: modelPath,
    loaded: true,
    exports: {
      findOneAndUpdate: async (query, update) => {
        const current = eventStore.get(query.eventId);
        if (!current) return null;
        if (current.deadLetter !== true) return null;
        if (!['failed', 'pending'].includes(current.status)) return null;
        if (current.lockExpiresAt && new Date(current.lockExpiresAt).getTime() > Date.now()) return null;
        const lastReplay = current?.metadata?.lastManualReplayAt;
        if (lastReplay && new Date(lastReplay).getTime() >= Date.now() - 60000) return null;
        const next = { ...current, ...update.$set };
        eventStore.set(query.eventId, next);
        return next;
      },
      updateOne: async (query, update) => {
        const current = [...eventStore.values()].find((item) => item._id === query._id) ||
          eventStore.get(query.eventId);
        if (!current) return { modifiedCount: 0 };
        eventStore.set(current.eventId, {
          ...current,
          ...(update.$set || {}),
        });
        return { modifiedCount: 1 };
      },
    },
  };

  const auditLogs = [];
  require.cache[require.resolve(activityPath)] = {
    id: activityPath,
    filename: activityPath,
    loaded: true,
    exports: {
      create: async (doc) => {
        auditLogs.push(doc);
        return doc;
      },
    },
  };

  require.cache[require.resolve(authPath)] = {
    id: authPath,
    filename: authPath,
    loaded: true,
    exports: {
      isAllowedAdminEmail: () => allowedAdmin,
    },
  };

  require.cache[require.resolve(auditPath)] = {
    id: auditPath,
    filename: auditPath,
    loaded: true,
    exports: {
      logSecurityEvent: () => {},
      logSecurityWarning: () => {},
    },
  };

  return {
    controller: require(controllerPath),
    auditLogs,
  };
}

async function testUnauthorizedReplay() {
  const eventStore = new Map([
    ['evt-1', { _id: '1', eventId: 'evt-1', deadLetter: true, status: 'failed', metadata: {}, attempts: 3 }],
  ]);
  const { controller, auditLogs } = loadControllerWithStubs({ eventStore, allowedAdmin: false });
  const res = makeRes();
  await controller.replayDeadLetterEvent(makeReq(), res, () => {});
  assert(res.statusCode === 403, 'unauthorized replay should be blocked');
  assert(auditLogs.length >= 1, 'unauthorized replay should be audited');
}

async function testConcurrentReplayAttempts() {
  const eventStore = new Map([
    ['evt-1', { _id: '1', eventId: 'evt-1', deadLetter: true, status: 'failed', metadata: {}, attempts: 3, lockExpiresAt: new Date(Date.now() + 120000).toISOString() }],
  ]);
  const { controller } = loadControllerWithStubs({ eventStore, allowedAdmin: true });
  const res = makeRes();
  await controller.replayDeadLetterEvent(makeReq(), res, () => {});
  assert(res.statusCode === 409, 'locked event should reject concurrent replay');
}

async function testReplayOfProcessingEventRejected() {
  const eventStore = new Map([
    ['evt-1', { _id: '1', eventId: 'evt-1', deadLetter: true, status: 'processing', metadata: {}, attempts: 3 }],
  ]);
  const { controller } = loadControllerWithStubs({ eventStore, allowedAdmin: true });
  const res = makeRes();
  await controller.replayDeadLetterEvent(makeReq(), res, () => {});
  assert(res.statusCode === 409, 'processing event should not be manually replayed');
}

async function testReplaySuccessPath() {
  const eventStore = new Map([
    ['evt-1', { _id: '1', eventId: 'evt-1', deadLetter: true, status: 'failed', metadata: {}, attempts: 3 }],
  ]);
  const { controller, auditLogs } = loadControllerWithStubs({ eventStore, allowedAdmin: true });
  const res = makeRes();
  await controller.replayDeadLetterEvent(makeReq(), res, () => {});
  assert(res.statusCode === 200, 'valid dead-letter replay should succeed');
  const updated = eventStore.get('evt-1');
  assert(updated.status === 'pending', 'replayed event should move back to pending');
  assert(updated.deadLetter === false, 'dead-letter flag should be cleared');
  assert(auditLogs.some((log) => String(log.message || '').includes('SUCCESS')), 'success replay should be audited');
}

async function testReplayFailurePath() {
  const eventStore = new Map([
    ['evt-1', {
      _id: '1',
      eventId: 'evt-1',
      deadLetter: true,
      status: 'failed',
      metadata: { manualReplayAttempts: '5' },
      attempts: 3,
    }],
  ]);
  const { controller, auditLogs } = loadControllerWithStubs({ eventStore, allowedAdmin: true });
  const res = makeRes();
  await controller.replayDeadLetterEvent(makeReq(), res, () => {});
  assert(res.statusCode === 429, 'replay should fail when manual replay attempt limit exceeded');
  assert(auditLogs.length >= 1, 'replay rejection should be audited');
}

async function run() {
  await testUnauthorizedReplay();
  await testConcurrentReplayAttempts();
  await testReplayOfProcessingEventRejected();
  await testReplaySuccessPath();
  await testReplayFailurePath();
  // eslint-disable-next-line no-console
  console.log('outbox-deadletter-replay tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('outbox-deadletter-replay tests failed:', error);
  process.exit(1);
});
