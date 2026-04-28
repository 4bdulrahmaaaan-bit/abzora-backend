const measurementSchema = {
  type: 'object',
  additionalProperties: {
    type: 'number',
  },
};

const lodModelsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lod0: { type: 'string', minLength: 1 },
    lod1: { type: 'string' },
    lod2: { type: 'string' },
    preview: { type: 'string' },
  },
};

const upsertGarmentTemplateSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['slug', 'name', 'category'],
  properties: {
    id: { type: 'string' },
    slug: { type: 'string', minLength: 2 },
    name: { type: 'string', minLength: 2 },
    category: { type: 'string', minLength: 2 },
    modelUrls: lodModelsSchema,
    unity: {
      type: 'object',
      additionalProperties: true,
      properties: {
        assetBundleUrl: { type: 'string' },
        sceneKey: { type: 'string' },
      },
    },
    rigProfile: { type: 'string' },
    blendShapes: measurementSchema,
    customizableParts: {
      type: 'object',
      additionalProperties: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    supportedFits: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['slim', 'regular', 'relaxed', 'oversized', 'athletic'],
      },
    },
    defaultMaterialProfile: { type: 'string' },
    defaultColorHex: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$' },
    defaultFabricTextureUrl: { type: 'string' },
    cachePolicy: {
      type: 'object',
      additionalProperties: true,
      properties: {
        preload: { type: 'boolean' },
        ttlSeconds: { type: 'integer', minimum: 60 },
      },
    },
    active: { type: 'boolean' },
  },
};

const fitScoreSchema = {
  type: 'object',
  additionalProperties: false,
  anyOf: [
    { required: ['productId'] },
    { required: ['templateId'] },
    { required: ['category'] },
  ],
  properties: {
    productId: { type: 'string' },
    templateId: { type: 'string' },
    category: { type: 'string' },
    fitPreset: {
      type: 'string',
      enum: ['slim', 'regular', 'relaxed', 'oversized', 'athletic'],
    },
    userMeasurements: measurementSchema,
    sizeChart: {
      type: 'object',
      additionalProperties: measurementSchema,
    },
  },
};

const saveLookSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['productId', 'imageUrl'],
  properties: {
    productId: { type: 'string', minLength: 8 },
    templateId: { type: 'string' },
    imageUrl: { type: 'string', minLength: 10 },
    size: { type: 'string' },
    fitScore: { type: 'number', minimum: 0, maximum: 100 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    source: { type: 'string' },
  },
};

const tryOnSessionSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['productId', 'sessionId'],
  properties: {
    productId: { type: 'string', minLength: 10 },
    sessionId: { type: 'string', minLength: 6 },
    measurements: measurementSchema,
    bodyProfileSnapshot: measurementSchema,
    captureCount: { type: 'integer', minimum: 0 },
    outfitSwitchCount: { type: 'integer', minimum: 0 },
    averageFps: { type: 'number', minimum: 0 },
    averagePoseConfidence: { type: 'number', minimum: 0, maximum: 1 },
    status: {
      type: 'string',
      enum: ['active', 'completed', 'abandoned'],
    },
  },
};

module.exports = {
  fitScoreSchema,
  saveLookSchema,
  tryOnSessionSchema,
  upsertGarmentTemplateSchema,
};
