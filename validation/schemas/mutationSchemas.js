const amountSchema = {
  type: 'number',
  exclusiveMinimum: 0,
  maximum: 10000000,
};

const shortReasonSchema = {
  type: 'string',
  minLength: 3,
  maxLength: 500,
};

const createPaymentOrderSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: amountSchema,
    currency: { type: 'string', minLength: 3, maxLength: 3 },
    description: { type: 'string', maxLength: 200 },
  },
  required: ['amount'],
};

const verifyPaymentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    razorpay_order_id: { type: 'string', minLength: 1, maxLength: 120 },
    orderId: { type: 'string', minLength: 1, maxLength: 120 },
    razorpay_payment_id: { type: 'string', minLength: 1, maxLength: 120 },
    paymentId: { type: 'string', minLength: 1, maxLength: 120 },
    razorpay_signature: { type: 'string', minLength: 8, maxLength: 256 },
    signature: { type: 'string', minLength: 8, maxLength: 256 },
  },
  anyOf: [
    { required: ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature'] },
    { required: ['orderId', 'paymentId', 'signature'] },
  ],
};

const updateOrderStatusSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['placed', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    },
  },
  required: ['status'],
};

const updateDeliveryStatusSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deliveryStatus: {
      type: 'string',
      enum: ['Assigned', 'Picked up', 'Out for delivery', 'Delivered'],
    },
  },
  required: ['deliveryStatus'],
};

const updateRiderLocationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
  },
  required: ['latitude', 'longitude'],
};

const approveRefundRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: amountSchema,
  },
};

const rejectRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: shortReasonSchema,
  },
  required: ['reason'],
};

const createReturnRequestSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reason: shortReasonSchema,
    imageUrl: { type: 'string', format: 'uri', maxLength: 500 },
  },
  required: ['reason'],
};

module.exports = {
  approveRefundRequestSchema,
  approveReturnRequestSchema: { type: 'object', additionalProperties: false, properties: {} },
  createPaymentOrderSchema,
  createReturnRequestSchema,
  rejectRequestSchema,
  updateDeliveryStatusSchema,
  updateOrderStatusSchema,
  updateRiderLocationSchema,
  verifyPaymentSchema,
};

