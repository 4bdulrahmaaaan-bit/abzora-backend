const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function testOrderControllerRaceHardening() {
  const orderControllerPath = path.join(__dirname, '..', 'controllers', 'orderController.js');
  const source = read(orderControllerPath);

  // Security regression guard: atomic stock floor check must remain in place.
  assert(
    source.includes("stock: { $gte: quantity }"),
    'orderController must enforce stock >= quantity during deduction',
  );
  assert(
    source.includes('await session.withTransaction(async () => {'),
    'orderController must use mongoose transaction for paid/COD inventory mutation',
  );
  assert(
    source.includes('await deductInventoryAtomically(txOrder.items, session);'),
    'orderController paid flow must deduct inventory atomically in-session',
  );
  assert(
    source.includes('await deductInventoryAtomically(normalizedItems, session);'),
    'orderController COD flow must deduct inventory atomically in-session',
  );
}

function testPaymentControllerRaceHardening() {
  const paymentControllerPath = path.join(__dirname, '..', 'controllers', 'paymentController.js');
  const source = read(paymentControllerPath);

  // Security regression guard: webhook capture path must keep atomic stock updates.
  assert(
    source.includes("stock: { $gte: quantity }"),
    'paymentController must enforce stock >= quantity during webhook deduction',
  );
  assert(
    source.includes('await session.withTransaction(async () => {'),
    'paymentController webhook capture must use mongoose transaction',
  );
  assert(
    source.includes('await deductInventoryAtomically(txOrder.items || [], session);'),
    'paymentController webhook flow must deduct inventory atomically in-session',
  );
  assert(
    source.includes("deliveryLock?.status === 'lock_error'"),
    'paymentController must treat webhook lock failures as retriable errors, not duplicates',
  );
  assert(
    source.includes('PaymentOutboxEvent.create'),
    'paymentController must persist outbox events for post-commit side-effect replay safety',
  );
}

function testOrderControllerOutboxHardening() {
  const orderControllerPath = path.join(__dirname, '..', 'controllers', 'orderController.js');
  const source = read(orderControllerPath);
  assert(
    source.includes('PaymentOutboxEvent.create'),
    'orderController paid verification flow must persist outbox events',
  );
  assert(
    source.includes('status: \'failed\''),
    'orderController must mark outbox events as failed when side effects fail',
  );
}

function run() {
  testOrderControllerRaceHardening();
  testPaymentControllerRaceHardening();
  testOrderControllerOutboxHardening();
  // eslint-disable-next-line no-console
  console.log('payment-inventory-race-hardening tests passed');
}

run();
