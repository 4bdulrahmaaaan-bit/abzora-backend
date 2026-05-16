const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'config', 'db.js');
const mongoose = require('mongoose');

function resetEnv() {
  process.env.MONGO_URI = 'mongodb://example.com:27017/abzora';
  process.env.MONGO_CONNECT_MAX_ATTEMPTS = '3';
  process.env.MONGO_CONNECT_RETRY_BASE_MS = '1';
  process.env.MONGO_CONNECT_RETRY_MAX_MS = '2';
  process.env.MONGO_POOL_SATURATION_THRESHOLD = '0.8';
  process.env.MONGO_POOL_TIMEOUT_WINDOW_MS = '120000';
}

function reloadDbModule() {
  delete require.cache[require.resolve(dbPath)];
  return require(dbPath);
}

async function testStartupDbUnavailableScenario() {
  resetEnv();
  const originalConnect = mongoose.connect;
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 0;
  let attempts = 0;
  mongoose.connect = async () => {
    attempts += 1;
    throw new Error('mongo_down');
  };

  try {
    const connectDB = reloadDbModule();
    await assert.rejects(connectDB(), /mongo_down/);
    assert.equal(attempts, 3, 'startup should retry based on MONGO_CONNECT_MAX_ATTEMPTS');
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.readyState = originalReadyState;
  }
}

async function testTransientOutageRecovery() {
  resetEnv();
  const originalConnect = mongoose.connect;
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 0;
  let attempts = 0;
  mongoose.connect = async () => {
    attempts += 1;
    if (attempts < 2) {
      throw new Error('temporary_network_error');
    }
    mongoose.connection.readyState = 1;
    mongoose.connection.emit('connected');
    return mongoose.connection;
  };

  try {
    const connectDB = reloadDbModule();
    await assert.doesNotReject(connectDB());
    assert.equal(attempts, 2, 'startup should recover after transient failure');
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.readyState = originalReadyState;
  }
}

async function testMongoReconnectBehavior() {
  resetEnv();
  const originalConnect = mongoose.connect;
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 0;
  mongoose.connect = async () => {
    mongoose.connection.readyState = 1;
    mongoose.connection.emit('connected');
    return mongoose.connection;
  };

  try {
    const connectDB = reloadDbModule();
    const { getMongoHealth } = connectDB;
    await connectDB();
    const before = getMongoHealth().reconnectCount;
    mongoose.connection.emit('reconnected');
    const after = getMongoHealth().reconnectCount;
    assert.equal(after, before + 1, 'reconnect events should increment reconnectCount');
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.readyState = originalReadyState;
  }
}

async function testPoolExhaustionHandling() {
  resetEnv();
  const originalConnect = mongoose.connect;
  const originalGetClient = mongoose.connection.getClient;
  const originalReadyState = mongoose.connection.readyState;
  const fakeClient = new EventEmitter();
  mongoose.connection.getClient = () => fakeClient;
  mongoose.connection.readyState = 0;
  mongoose.connect = async () => {
    mongoose.connection.readyState = 1;
    mongoose.connection.emit('connected');
    return mongoose.connection;
  };

  try {
    const connectDB = reloadDbModule();
    const { getMongoHealth } = connectDB;
    await connectDB();
    fakeClient.emit('connectionPoolCreated', { options: { maxPoolSize: 10, minPoolSize: 2 } });
    for (let i = 0; i < 9; i += 1) {
      fakeClient.emit('connectionCheckedOut');
    }
    const health = getMongoHealth();
    assert.equal(health.pool.poolExhausted, true, 'pool saturation should mark pool exhausted');
  } finally {
    mongoose.connect = originalConnect;
    mongoose.connection.getClient = originalGetClient;
    mongoose.connection.readyState = originalReadyState;
  }
}

async function testReadinessDegradationBehavior() {
  const serverJsPath = path.join(__dirname, '..', 'server.js');
  const source = require('fs').readFileSync(serverJsPath, 'utf8');
  assert(
    source.includes('mongoPoolExhausted'),
    'readiness should explicitly track mongo pool exhaustion',
  );
  assert(
    source.includes('!mongoPoolExhausted'),
    'readiness should fail when mongo pool is exhausted',
  );
}

async function run() {
  await testStartupDbUnavailableScenario();
  await testTransientOutageRecovery();
  await testMongoReconnectBehavior();
  await testPoolExhaustionHandling();
  await testReadinessDegradationBehavior();
  // eslint-disable-next-line no-console
  console.log('mongo-resilience tests passed');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('mongo-resilience tests failed:', error);
  process.exitCode = 1;
});
