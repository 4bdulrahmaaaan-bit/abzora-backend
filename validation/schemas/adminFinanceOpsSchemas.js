const idString = { type: 'string', minLength: 1, maxLength: 128 };
const optionalId = { type: 'string', minLength: 1, maxLength: 128 };
const shortText = { type: 'string', minLength: 1, maxLength: 300 };
const longText = { type: 'string', minLength: 1, maxLength: 3000 };

const statusQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', maxLength: 40 },
  },
};

const cityQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    city: { type: 'string', maxLength: 80 },
  },
};

const paginationQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    page: { type: 'integer', minimum: 1, maximum: 10000 },
  },
};

const opsAlertsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  },
};

const opsMetricsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['hourly', 'daily'] },
    limit: { type: 'integer', minimum: 1, maximum: 168 },
  },
};

const opsMapQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    city: { type: 'string', maxLength: 80 },
    zoneId: { type: 'string', maxLength: 120 },
    orderStatus: { type: 'string', maxLength: 40 },
    riderStatus: { type: 'string', maxLength: 40 },
    severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
  },
};

const orderStatusListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['all', 'pending', 'approved', 'rejected', 'requested', 'completed'] },
  },
};

const productListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    storeId: { type: 'string', maxLength: 64 },
    category: { type: 'string', maxLength: 120 },
    minPrice: { type: 'number', minimum: 0, maximum: 10000000 },
    maxPrice: { type: 'number', minimum: 0, maximum: 10000000 },
    rating: { type: 'number', minimum: 0, maximum: 5 },
    size: { type: 'string', maxLength: 120 },
    sort: { type: 'string', maxLength: 40 },
    page: { type: 'integer', minimum: 1, maximum: 10000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    sameDayAvailable: { type: 'string', enum: ['true', 'false', '1', '0', 'yes', 'no'] },
    sameDay: { type: 'string', enum: ['true', 'false', '1', '0', 'yes', 'no'] },
    tryAtHomeAvailable: { type: 'string', enum: ['true', 'false', '1', '0', 'yes', 'no'] },
    customizable: { type: 'string', enum: ['true', 'false', '1', '0', 'yes', 'no'] },
    atelier: { type: 'string', enum: ['true', 'false', '1', '0', 'yes', 'no'] },
    city: { type: 'string', maxLength: 80 },
    ignoreCutoff: { type: 'string', enum: ['true', 'false'] },
    sortBy: { type: 'string', maxLength: 40 },
  },
};

const storeListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    atelier: { type: 'string', enum: ['true', 'false'] },
    customizable: { type: 'string', enum: ['true', 'false'] },
    category: { type: 'string', maxLength: 120 },
    style: { type: 'string', maxLength: 120 },
    budgetMin: { type: 'number', minimum: 0, maximum: 10000000 },
    budgetMax: { type: 'number', minimum: 0, maximum: 10000000 },
    deliveryDays: { type: 'integer', minimum: 0, maximum: 365 },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
  },
};

const logisticsDeliveryCheckQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    product_id: { type: 'string', maxLength: 64 },
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    pincode: { type: 'string', maxLength: 20 },
    locality: { type: 'string', maxLength: 120 },
    city: { type: 'string', maxLength: 120 },
    state: { type: 'string', maxLength: 120 },
  },
};

const logisticsVendorOrdersQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', maxLength: 40 },
    storeId: { type: 'string', maxLength: 64 },
  },
};

const logisticsVendorTrialsQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', maxLength: 40 },
    approvalStatus: { type: 'string', maxLength: 40 },
  },
};

const runSettlementsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    walletType: { type: 'string', enum: ['vendor', 'rider'] },
  },
  required: ['walletType'],
};

const fraudAlertUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['open', 'reviewing', 'resolved', 'ignored'] },
  },
  required: ['status'],
};

const payoutProfileSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    methodType: { type: 'string', maxLength: 40 },
    accountHolderName: { type: 'string', maxLength: 120 },
    upiId: { type: 'string', maxLength: 120 },
    bankAccountNumber: { type: 'string', maxLength: 60 },
    bankIfsc: { type: 'string', maxLength: 30 },
    bankName: { type: 'string', maxLength: 120 },
  },
};

const withdrawalRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 10000000 },
    note: { type: 'string', maxLength: 500 },
  },
  required: ['amount'],
};

const adminNotificationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: optionalId,
    title: shortText,
    body: longText,
    type: { type: 'string', maxLength: 40 },
    isRead: { type: 'boolean' },
    timestamp: { type: 'string', maxLength: 80 },
    audienceRole: { type: 'string', maxLength: 40 },
    userId: { type: 'string', maxLength: 128 },
    storeId: { type: 'string', maxLength: 128 },
  },
  required: ['title', 'body'],
};

const processPayoutSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    storeId: idString,
    periodLabel: { type: 'string', maxLength: 120 },
  },
  required: ['storeId'],
};

const processRefundSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    paymentId: { type: 'string', minLength: 1, maxLength: 120 },
    refundRequestId: { type: 'string', minLength: 1, maxLength: 120 },
    reason: { type: 'string', maxLength: 500 },
  },
  required: ['paymentId', 'refundRequestId'],
};

const disputeUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: optionalId,
    orderId: { type: 'string', maxLength: 128 },
    userId: { type: 'string', maxLength: 128 },
    storeId: { type: 'string', maxLength: 128 },
    type: { type: 'string', maxLength: 120 },
    status: { type: 'string', maxLength: 40 },
    amount: { type: 'number', minimum: 0, maximum: 10000000 },
    reason: { type: 'string', maxLength: 500 },
    createdAt: { type: 'string', maxLength: 80 },
  },
};

const activityLogCreateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: optionalId,
    actorId: { type: 'string', maxLength: 128 },
    actorRole: { type: 'string', maxLength: 40 },
    action: shortText,
    targetType: { type: 'string', maxLength: 80 },
    targetId: { type: 'string', maxLength: 128 },
    message: { type: 'string', maxLength: 1000 },
    timestamp: { type: 'string', maxLength: 80 },
  },
  required: ['action'],
};

const kycReviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['approved', 'rejected', 'review'] },
    reason: { type: 'string', maxLength: 500 },
    override: { type: 'object' },
  },
  required: ['status'],
};

const trialHomeUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', maxLength: 60 },
    note: { type: 'string', maxLength: 1000 },
    paymentStatus: { type: 'string', maxLength: 60 },
  },
};

const userActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: optionalId,
    action: { type: 'string', minLength: 1, maxLength: 60 },
    reason: { type: 'string', maxLength: 500 },
  },
  required: ['action'],
};

const userRoleSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: optionalId,
    role: { type: 'string', minLength: 1, maxLength: 40 },
    reason: { type: 'string', minLength: 3, maxLength: 500 },
  },
  required: ['role', 'reason'],
};

const productActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', minLength: 1, maxLength: 60 },
    reason: { type: 'string', maxLength: 500 },
    name: { type: 'string', maxLength: 180 },
    price: { type: 'number', minimum: 0, maximum: 10000000 },
    stock: { type: 'number', minimum: 0, maximum: 1000000 },
    description: { type: 'string', maxLength: 2000 },
    launchAt: { type: 'string', maxLength: 80 },
  },
  required: ['action'],
};

const simpleAdminIdBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    userId: idString,
    phone: { type: 'string', maxLength: 30 },
  },
};

const dispatchRecommendSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    distance: { type: 'number', minimum: 0, maximum: 1000 },
    activeOrders: { type: 'number', minimum: 0, maximum: 10000 },
    rating: { type: 'number', minimum: 0, maximum: 5 },
    batchEfficiency: { type: 'number', minimum: 0, maximum: 100 },
  },
};

const bulkFleetActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', minLength: 1, maxLength: 80 },
    riderIds: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
  required: ['action'],
};

const outboxDeadLetterReplaySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: { type: 'string', minLength: 8, maxLength: 500 },
  },
  required: ['reason'],
};

module.exports = {
  activityLogCreateSchema,
  adminNotificationSchema,
  bulkFleetActionSchema,
  cityQuerySchema,
  dispatchRecommendSchema,
  disputeUpdateSchema,
  fraudAlertUpdateSchema,
  kycReviewSchema,
  opsAlertsQuerySchema,
  opsMapQuerySchema,
  opsMetricsQuerySchema,
  outboxDeadLetterReplaySchema,
  orderStatusListQuerySchema,
  paginationQuerySchema,
  payoutProfileSchema,
  processPayoutSchema,
  processRefundSchema,
  runSettlementsSchema,
  simpleAdminIdBodySchema,
  statusQuerySchema,
  productListQuerySchema,
  storeListQuerySchema,
  logisticsDeliveryCheckQuerySchema,
  logisticsVendorOrdersQuerySchema,
  logisticsVendorTrialsQuerySchema,
  trialHomeUpdateSchema,
  userActionSchema,
  userRoleSchema,
  productActionSchema,
  withdrawalRequestSchema,
};
