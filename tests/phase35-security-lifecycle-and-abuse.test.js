const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeReq(overrides = {}) {
  return {
    headers: {},
    body: {},
    originalUrl: '/secure/test',
    protocol: 'https',
    requestId: 'req-test',
    ...overrides,
  };
}

function makeRes() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.payload = obj;
      return this;
    },
  };
}

function loadAuthMiddlewareWithStubs({
  verifyIdTokenImpl,
  userFindOneImpl,
  userCreateImpl,
}) {
  const authPath = path.join(__dirname, '..', 'middleware', 'authMiddleware.js');
  const firebasePath = path.join(__dirname, '..', 'config', 'firebase.js');
  const userPath = path.join(__dirname, '..', 'models', 'User.js');
  const auditPath = path.join(__dirname, '..', 'services', 'auditLogger.js');

  delete require.cache[require.resolve(authPath)];
  delete require.cache[require.resolve(firebasePath)];
  delete require.cache[require.resolve(userPath)];
  delete require.cache[require.resolve(auditPath)];

  require.cache[require.resolve(firebasePath)] = {
    id: firebasePath,
    filename: firebasePath,
    loaded: true,
    exports: () => ({
      auth: () => ({
        verifyIdToken: verifyIdTokenImpl,
      }),
    }),
  };

  require.cache[require.resolve(userPath)] = {
    id: userPath,
    filename: userPath,
    loaded: true,
    exports: {
      findOne: userFindOneImpl,
      create: userCreateImpl,
      find: async () => [],
    },
  };

  require.cache[require.resolve(auditPath)] = {
    id: auditPath,
    filename: auditPath,
    loaded: true,
    exports: {
      clientIp: () => '127.0.0.1',
      logSecurityWarning: () => {},
    },
  };

  return require(authPath);
}

async function runMiddleware(authMiddleware, req) {
  const res = makeRes();
  let calledNext = false;
  await authMiddleware(req, res, () => {
    calledNext = true;
  });
  return { res, calledNext };
}

async function testSessionLifecycle() {
  const nowSec = Math.floor(Date.now() / 1000);

  const activeUser = {
    _id: 'u1',
    uid: 'uid-1',
    firebaseUid: 'uid-1',
    role: 'customer',
    roles: { customer: true },
    isActive: true,
    save: async () => {},
  };

  let createCount = 0;
  const authMiddleware = loadAuthMiddlewareWithStubs({
    verifyIdTokenImpl: async (token, checkRevoked) => {
      assert(checkRevoked === true, 'verifyIdToken should enforce revocation checks');
      if (token === 'revoked-token') {
        const error = new Error('revoked');
        error.code = 'auth/id-token-revoked';
        throw error;
      }
      if (token === 'expired-token') {
        const error = new Error('expired');
        error.code = 'auth/id-token-expired';
        throw error;
      }
      if (token === 'stale-token') {
        return {
          uid: 'uid-1',
          email_verified: true,
          auth_time: nowSec - 9 * 60 * 60,
        };
      }
      return {
        uid: token === 'deleted-user-token' ? 'uid-deleted' : 'uid-1',
        email: 'member@example.com',
        email_verified: true,
        auth_time: nowSec,
      };
    },
    userFindOneImpl: async (query) => {
      if (query && query.$or) {
        const byUid = query.$or.find((item) => item.firebaseUid === 'uid-deleted' || item.uid === 'uid-deleted');
        if (byUid) {
          return null;
        }
      }
      if (query && (query.firebaseUid === 'uid-disabled' || query.uid === 'uid-disabled')) {
        return {
          ...activeUser,
          uid: 'uid-disabled',
          firebaseUid: 'uid-disabled',
          isActive: false,
        };
      }
      return activeUser;
    },
    userCreateImpl: async (payload) => {
      createCount += 1;
      return {
        ...activeUser,
        ...payload,
        save: async () => {},
      };
    },
  });

  const noBearer = await runMiddleware(authMiddleware, makeReq());
  assert(noBearer.res.statusCode === 401, 'missing bearer token should be rejected');

  const stale = await runMiddleware(
    authMiddleware,
    makeReq({ headers: { authorization: 'Bearer stale-token' } }),
  );
  assert(stale.res.statusCode === 401, 'stale auth_time token should be rejected');

  const revoked = await runMiddleware(
    authMiddleware,
    makeReq({ headers: { authorization: 'Bearer revoked-token' } }),
  );
  assert(revoked.res.statusCode === 401, 'revoked token should be rejected');

  const expired = await runMiddleware(
    authMiddleware,
    makeReq({ headers: { authorization: 'Bearer expired-token' } }),
  );
  assert(expired.res.statusCode === 401, 'expired token should be rejected');

  const accepted = await runMiddleware(
    authMiddleware,
    makeReq({ headers: { authorization: 'Bearer active-token' } }),
  );
  assert(accepted.calledNext === true, 'active token should pass auth middleware');

  const reprovisioned = await runMiddleware(
    authMiddleware,
    makeReq({ headers: { authorization: 'Bearer deleted-user-token' } }),
  );
  assert(reprovisioned.calledNext === false, 'deleted DB user token must not pass auth');
  assert(reprovisioned.res.statusCode === 403, 'deleted DB user token must be rejected with 403');
  assert(createCount === 0, 'deleted DB user token must not auto-provision local user');

  return {
    deletedUserTokenGap: false,
  };
}

function testDeepLinkBypassMounts() {
  const serverJs = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert(
    serverJs.includes("app.use('/admin', adminLimiter, authMiddleware, requireAdmin, adminRoutes);"),
    'admin routes must be guarded by auth + requireAdmin',
  );
  assert(
    serverJs.includes("app.use('/vendor', authMiddleware, requireVendor, vendorRoutes);"),
    'vendor routes must be guarded by auth + requireVendor',
  );
  assert(
    serverJs.includes("app.use('/rider', authMiddleware, requireRider, riderRoutes);"),
    'rider routes must be guarded by auth + requireRider',
  );
}

function testUploadSecurity() {
  const uploadRoutes = require('fs').readFileSync(path.join(__dirname, '..', 'routes', 'uploadRoutes.js'), 'utf8');
  const uploadController = require('fs').readFileSync(path.join(__dirname, '..', 'controllers', 'uploadController.js'), 'utf8');

  assert(uploadRoutes.includes('multer.memoryStorage()'), 'uploads must use memory storage to avoid direct path traversal writes');
  assert(uploadRoutes.includes("fileSize: 5 * 1024 * 1024"), 'uploads must enforce 5MB file size limit');
  assert(uploadRoutes.includes("mime === 'image/svg+xml'"), 'uploads must reject SVG payloads');
  assert(uploadController.includes('detectImageType(req.file.buffer)'), 'uploads must perform magic-byte detection');
  assert(uploadController.includes('detectedMimeType !== req.file.mimetype'), 'uploads must reject MIME/extension spoof mismatch');
}

function testRateLimitCoverage() {
  const serverJs = require('fs').readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  assert(serverJs.includes("app.use('/auth', authLimiter, authRoutes);"), 'auth routes must be rate-limited');
  assert(serverJs.includes("app.use('/support', supportLimiter, supportRoutes);"), 'support routes must be rate-limited');
  assert(serverJs.includes("app.use('/', socialLimiter, socialRoutes);"), 'social routes must be rate-limited');
  assert(serverJs.includes("app.use('/wallet', withdrawalLimiter, authMiddleware, walletRoutes);"), 'wallet routes must be rate-limited');
  assert(
    serverJs.includes("app.use('/webhooks/razorpayx', webhookLimiter, express.raw({ type: 'application/json', limit: '1mb' }));"),
    'razorpayx webhook must be rate-limited before body parse',
  );
  assert(
    serverJs.includes("app.use('/webhooks/razorpay', webhookLimiter, express.raw({ type: 'application/json', limit: '1mb' }));"),
    'razorpay webhook must be rate-limited before body parse',
  );
}

async function main() {
  const sessionResult = await testSessionLifecycle();
  testDeepLinkBypassMounts();
  testUploadSecurity();
  testRateLimitCoverage();

  // eslint-disable-next-line no-console
  console.log('phase35-security-lifecycle-and-abuse: PASS');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error.message || error);
  process.exit(1);
});
