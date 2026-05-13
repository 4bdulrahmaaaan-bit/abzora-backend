const fs = require('fs');
const path = require('path');

const {
  approveRefundRequestSchema,
  createPaymentOrderSchema,
  createReturnRequestSchema,
  rejectRequestSchema,
  updateDeliveryStatusSchema,
  updateOrderStatusSchema,
  updateRiderLocationSchema,
  verifyPaymentSchema,
} = require('../validation/schemas/mutationSchemas');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runSchemaTests() {
  assert(createPaymentOrderSchema.additionalProperties === false, 'payment order schema must reject unknown fields');
  assert(createPaymentOrderSchema.required.includes('amount'), 'payment order schema must require amount');
  assert(verifyPaymentSchema.additionalProperties === false, 'verify payment schema must reject unknown fields');
  assert(Array.isArray(verifyPaymentSchema.anyOf) && verifyPaymentSchema.anyOf.length === 2, 'verify payment schema must enforce canonical aliases');
  assert(updateOrderStatusSchema.additionalProperties === false, 'order status schema must reject unknown fields');
  assert(updateOrderStatusSchema.required.includes('status'), 'order status schema must require status');
  assert(updateDeliveryStatusSchema.required.includes('deliveryStatus'), 'delivery status schema must require deliveryStatus');
  assert(updateRiderLocationSchema.required.includes('latitude') && updateRiderLocationSchema.required.includes('longitude'), 'rider location schema must require both coordinates');
  assert(approveRefundRequestSchema.additionalProperties === false, 'refund approve schema must reject unknown fields');
  assert(rejectRequestSchema.required.includes('reason'), 'reject schema must require reason');
  assert(createReturnRequestSchema.required.includes('reason'), 'return request schema must require reason');
}

function runRouteGuardTests() {
  const orderRoutes = fs.readFileSync(path.join(__dirname, '../routes/orderRoutes.js'), 'utf8');
  const paymentRoutes = fs.readFileSync(path.join(__dirname, '../routes/paymentRoutes.js'), 'utf8');
  const payoutRoutes = fs.readFileSync(path.join(__dirname, '../routes/payoutRoutes.js'), 'utf8');
  const adminRoutes = fs.readFileSync(path.join(__dirname, '../routes/adminRoutes.js'), 'utf8');
  const opsRoutes = fs.readFileSync(path.join(__dirname, '../routes/opsRoutes.js'), 'utf8');
  const fleetRoutes = fs.readFileSync(path.join(__dirname, '../routes/fleetRoutes.js'), 'utf8');
  const authRoutes = fs.readFileSync(path.join(__dirname, '../routes/authRoutes.js'), 'utf8');
  const trackingRoutes = fs.readFileSync(path.join(__dirname, '../routes/trackingRoutes.js'), 'utf8');
  const supportRoutes = fs.readFileSync(path.join(__dirname, '../routes/supportRoutes.js'), 'utf8');
  const chatRoutes = fs.readFileSync(path.join(__dirname, '../routes/chatRoutes.js'), 'utf8');
  const socialRoutes = fs.readFileSync(path.join(__dirname, '../routes/socialRoutes.js'), 'utf8');
  const serverJs = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

  assert(
    orderRoutes.includes('router.use(authMiddleware);'),
    'orderRoutes must enforce auth middleware globally',
  );
  assert(
    paymentRoutes.includes('router.use(authMiddleware);'),
    'paymentRoutes must enforce auth middleware globally',
  );
  assert(
    payoutRoutes.includes('router.use(authMiddleware);'),
    'payoutRoutes must enforce auth middleware globally',
  );
  assert(
    adminRoutes.includes('validateQuery('),
    'adminRoutes should enforce query validation on list endpoints',
  );
  assert(
    opsRoutes.includes('validateQuery('),
    'opsRoutes should enforce query validation on list endpoints',
  );
  assert(
    fleetRoutes.includes('validateQuery('),
    'fleetRoutes should enforce query validation on list endpoints',
  );
  assert(
    trackingRoutes.includes('validateBody('),
    'trackingRoutes should enforce body validation on mutation endpoints',
  );
  assert(
    supportRoutes.includes('validateQuery(') && supportRoutes.includes('validateBody('),
    'supportRoutes should enforce query and body validation',
  );
  assert(
    chatRoutes.includes('validateBody('),
    'chatRoutes should enforce body validation',
  );
  assert(
    socialRoutes.includes('validateQuery(') && socialRoutes.includes('validateBody('),
    'socialRoutes should enforce query and body validation',
  );
  assert(
    authRoutes.includes('referrals/apply') && authRoutes.includes('validateBody('),
    'authRoutes should enforce body validation on referral/growth mutations',
  );
  assert(
    serverJs.includes("app.use('/debug', adminLimiter, authMiddleware, requireAdmin, debugRoutes);"),
    'debug route must require admin auth',
  );
}

function main() {
  runSchemaTests();
  runRouteGuardTests();
  // eslint-disable-next-line no-console
  console.log('security-mutation-validation: PASS');
}

main();
