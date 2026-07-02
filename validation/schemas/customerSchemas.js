const emptyBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const supportListQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['all', 'open', 'closed'] },
    type: { type: 'string', maxLength: 40 },
  },
};

const supportMessagesQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    before: { type: 'string', maxLength: 80 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
  },
};

const supportCreateChatSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    issueType: { type: 'string', maxLength: 40 },
  },
};

const supportSendMessageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', maxLength: 4000 },
    imageUrl: { type: 'string', format: 'uri', maxLength: 500 },
    assistantReplyText: { type: 'string', maxLength: 4000 },
    status: { type: 'string', enum: ['open', 'closed'] },
  },
};

const chatSendMessageSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 4000 },
  },
  required: ['text'],
};

const trackingLocationUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    orderId: { type: 'string', maxLength: 64 },
    taskId: { type: 'string', maxLength: 64 },
    riderId: { type: 'string', maxLength: 128 },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    speedKmph: { type: 'number', minimum: 0, maximum: 300 },
    status: { type: 'string', maxLength: 40 },
    heading: { type: 'number', minimum: 0, maximum: 360 },
  },
  required: ['latitude', 'longitude'],
  anyOf: [{ required: ['orderId'] }, { required: ['taskId'] }],
};

const trackingOrderStatusUpdateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    orderId: { type: 'string', minLength: 1, maxLength: 64 },
    status: { type: 'string', maxLength: 40 },
  },
  required: ['orderId', 'status'],
};

const socialShareLookSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lookId: { type: 'string', maxLength: 64 },
    imageUrl: { type: 'string', format: 'uri', maxLength: 500 },
    productIds: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 64 } },
    caption: { type: 'string', maxLength: 280 },
    outfitId: { type: 'string', maxLength: 64 },
    source: { type: 'string', maxLength: 40 },
    visibility: { type: 'string', enum: ['public', 'private'] },
  },
};

const socialVoteSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reaction: { type: 'string', enum: ['looks_good', 'must_buy', 'not_great'] },
  },
  required: ['reaction'],
};

const socialCreatePostSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lookShareId: { type: 'string', maxLength: 64 },
    imageUrl: { type: 'string', format: 'uri', maxLength: 500 },
    productIds: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 64 } },
    caption: { type: 'string', maxLength: 280 },
    tags: { type: 'array', maxItems: 12, items: { type: 'string', maxLength: 40 } },
  },
};

const socialFeedQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 24 },
  },
};

const referralApplySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 3, maxLength: 30 },
  },
  required: ['code'],
};

const growthOfferValidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 64 },
    cartValue: { type: 'number', minimum: 0, maximum: 10000000 },
  },
};

const growthOfferClaimSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 64 },
  },
  required: ['code'],
};

const couponValidateSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', minLength: 1, maxLength: 64 },
    cartValue: { type: 'number', minimum: 0, maximum: 10000000 },
  },
  required: ['code'],
};

module.exports = {
  chatSendMessageSchema,
  emptyBodySchema,
  couponValidateSchema,
  growthOfferClaimSchema,
  growthOfferValidateSchema,
  referralApplySchema,
  socialCreatePostSchema,
  socialFeedQuerySchema,
  socialShareLookSchema,
  socialVoteSchema,
  supportCreateChatSchema,
  supportListQuerySchema,
  supportMessagesQuerySchema,
  supportSendMessageSchema,
  trackingLocationUpdateSchema,
  trackingOrderStatusUpdateSchema,
};
