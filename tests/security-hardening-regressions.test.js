const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function freshRequire(modulePath) {
  delete require.cache[require.resolve(modulePath)];
  return require(modulePath);
}

function snapshotEnv(keys) {
  const snapshot = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
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

async function testPrivateArtifactUrls() {
  const invoiceStoragePath = path.join(__dirname, '..', 'services', 'invoiceStorageService.js');
  const arStoragePath = path.join(__dirname, '..', 'services', 'arModelArtifactStorageService.js');
  const originalWriteFileSync = fs.writeFileSync;
  const originalMkdirSync = fs.mkdirSync;
  const originalProvider = process.env.INVOICE_STORAGE_PROVIDER;

  process.env.INVOICE_STORAGE_PROVIDER = 'local';
  fs.writeFileSync = () => {};
  fs.mkdirSync = () => {};

  try {
    const invoiceStorage = freshRequire(invoiceStoragePath);
    const saved = await invoiceStorage.savePdf({
      invoiceNumber: 'ABZ-2026-0001',
      versionLabel: 'v1',
      pdfBuffer: Buffer.from('%PDF-1.4'),
    });
    assert.equal(saved.url.startsWith('internal://invoices/'), true, 'local invoice URLs must not be public');
    assert.equal(saved.url.includes('/files/'), false, 'local invoice URLs must not point at a public static route');

    const artifactStorage = freshRequire(arStoragePath);
    const artifact = artifactStorage.writeArtifact({
      modelVersion: 'v1',
      artifactType: 'weights',
      payload: { ok: true },
    });
    assert.equal(artifact.uri.startsWith('internal://ar-models/v1/weights.json'), true, 'AR artifact URIs must be private');
    assert.equal(artifact.uri.includes('/files/'), false, 'AR artifact URIs must not expose a public static route');
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.mkdirSync = originalMkdirSync;
    if (originalProvider === undefined) {
      delete process.env.INVOICE_STORAGE_PROVIDER;
    } else {
      process.env.INVOICE_STORAGE_PROVIDER = originalProvider;
    }
  }
}

async function testInvoiceSigningSecretAndVerification() {
  const signingPath = path.join(__dirname, '..', 'services', 'invoiceSigningService.js');
  const env = snapshotEnv(['INVOICE_SIGNING_SECRET', 'JWT_SECRET']);

  try {
    delete process.env.INVOICE_SIGNING_SECRET;
    delete process.env.JWT_SECRET;

    const signing = freshRequire(signingPath);
    assert.throws(
      () =>
        signing.buildSignedToken({
          invoiceId: 'inv-1',
          userId: 'user-1',
          role: 'customer',
          expiresAt: Date.now() + 60_000,
        }),
      /INVOICE_SIGNING_SECRET is required/i,
      'invoice signing must fail closed when the secret is missing',
    );
    assert.equal(signing.verifySignedToken('bad.token.value').valid, false, 'verification must fail closed without a secret');

    process.env.INVOICE_SIGNING_SECRET = 'security-regression-secret';
    const signingWithSecret = freshRequire(signingPath);
    const token = signingWithSecret.buildSignedToken({
      invoiceId: 'inv-2',
      userId: 'user-2',
      role: 'customer',
      version: 'v2',
      expiresAt: Date.now() + 60_000,
    });
    const verified = signingWithSecret.verifySignedToken(token);
    assert.equal(verified.valid, true, 'valid signed token must verify');
    assert.equal(verified.version, 'v2', 'token version must round-trip');
  } finally {
    restoreEnv(env);
  }
}

async function testResendWebhookVerificationFailsClosed() {
  const lifecyclePath = path.join(__dirname, '..', 'services', 'invoiceEmailLifecycleService.js');
  const env = snapshotEnv(['RESEND_WEBHOOK_SECRET']);

  try {
    delete process.env.RESEND_WEBHOOK_SECRET;
    const lifecycle = freshRequire(lifecyclePath);
    assert.equal(
      lifecycle.verifyResendWebhookSignature('{"event":"bounce"}', 'deadbeef'),
      false,
      'webhook verification must fail closed when the secret is missing',
    );

    process.env.RESEND_WEBHOOK_SECRET = 'resend-secret';
    const signedLifecycle = freshRequire(lifecyclePath);
    const rawBody = '{"event":"bounce","email":"user@example.com"}';
    const signature = crypto.createHmac('sha256', process.env.RESEND_WEBHOOK_SECRET).update(rawBody).digest('hex');
    assert.equal(
      signedLifecycle.verifyResendWebhookSignature(rawBody, signature),
      true,
      'valid webhook signatures must still verify',
    );
  } finally {
    restoreEnv(env);
  }
}

async function testPhoneLookupIsExactOnly() {
  const userModelPath = path.join(__dirname, '..', 'models', 'User.js');
  const middlewarePath = path.join(__dirname, '..', 'middleware', 'authMiddleware.js');
  const userModel = require(userModelPath);
  const original = {
    findOne: userModel.findOne,
    find: userModel.find,
    create: userModel.create,
  };
  const capturedQueries = [];

  userModel.findOne = async (query) => {
    capturedQueries.push(query);
    return null;
  };
  userModel.find = async () => {
    throw new Error('unexpected fuzzy phone lookup');
  };
  userModel.create = async (doc) => ({
    ...doc,
    save: async () => {},
  });

  try {
    const authMiddleware = freshRequire(middlewarePath);
    await authMiddleware.upsertFirebaseUser(
      {
        uid: 'uid-1',
        email: 'ops@example.com',
        phone_number: '+919876543210',
        name: 'Test User',
        email_verified: false,
      },
      { allowCreate: true },
    );

    assert.equal(capturedQueries.length, 1, 'phone lookup should be done with a single exact query');
    const query = capturedQueries[0];
    const phoneClauses = Array.isArray(query.$or) ? query.$or.filter((clause) => clause.phone != null) : [];
    assert.equal(phoneClauses.length >= 1, true, 'phone lookup must include a phone predicate');
    assert.equal(phoneClauses.some((clause) => clause.phone instanceof RegExp), false, 'phone lookup must not use regex matching');
    assert.equal(
      phoneClauses.some((clause) => String(clause.phone) === '9876543210'),
      false,
      'phone lookup must not use 10-digit tail matching',
    );
  } finally {
    userModel.findOne = original.findOne;
    userModel.find = original.find;
    userModel.create = original.create;
  }
}

async function testUserLookupAuthorization() {
  const userModelPath = path.join(__dirname, '..', 'models', 'User.js');
  const orderModelPath = path.join(__dirname, '..', 'models', 'Order.js');
  const controllerPath = path.join(__dirname, '..', 'controllers', 'authController.js');
  const userModel = require(userModelPath);
  const orderModel = require(orderModelPath);
  const originalUserFindOne = userModel.findOne;
  const originalOrderExists = orderModel.exists;

  const targetUser = {
    _id: 'user-2',
    uid: 'user-2',
    firebaseUid: 'user-2',
    role: 'customer',
    name: 'Customer Two',
  };

  try {
    userModel.findOne = async () => targetUser;
    orderModel.exists = async () => false;
    const authController = freshRequire(controllerPath);

    const denied = makeRes();
    await authController.getUserByIdentifier(
      {
        params: { id: 'user-2' },
        user: { uid: 'vendor-1', role: 'vendor', storeId: 'store-1' },
      },
      denied,
      () => {},
    );
    assert.equal(denied.statusCode, 403, 'vendor without an order relationship must be blocked from arbitrary user lookup');

    assert.equal(
      await authController.canAccessUserProfile({ uid: 'admin-1', role: 'admin' }, targetUser),
      true,
      'admins must retain broad access',
    );

    orderModel.exists = async () => true;
    assert.equal(
      await authController.canAccessUserProfile({ uid: 'vendor-1', role: 'vendor', storeId: 'store-1' }, targetUser),
      true,
      'vendors should only be able to view users that have a matching order relationship',
    );
  } finally {
    userModel.findOne = originalUserFindOne;
    orderModel.exists = originalOrderExists;
  }
}

async function testOrderTaxIsServerDerived() {
  const orderControllerPath = path.join(__dirname, '..', 'controllers', 'orderController.js');
  const env = snapshotEnv(['ORDER_TAX_RATE', 'DEFAULT_TAX_RATE']);

  try {
    process.env.ORDER_TAX_RATE = '18';
    const orderController = freshRequire(orderControllerPath);
    const tax = orderController.resolveOrderTaxAmount({
      subtotalAmount: 100,
      items: [{ price: 100, quantity: 1 }],
    });
    assert.equal(tax, 18, 'tax must be derived from the server-side pricing rule');

    const source = fs.readFileSync(orderControllerPath, 'utf8');
    assert.equal(
      source.includes('taxAmount: sanitizeTaxAmount(taxAmount)'),
      false,
      'client-provided tax must no longer flow directly into pricing',
    );
    assert(
      source.includes('resolveOrderTaxAmount({ subtotalAmount'),
      'order controller must route checkout tax through the server-side resolver',
    );
  } finally {
    restoreEnv(env);
  }
}

async function main() {
  await testPrivateArtifactUrls();
  await testInvoiceSigningSecretAndVerification();
  await testResendWebhookVerificationFailsClosed();
  await testPhoneLookupIsExactOnly();
  await testUserLookupAuthorization();
  await testOrderTaxIsServerDerived();
  // eslint-disable-next-line no-console
  console.log('security-hardening-regressions.test: ok');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
