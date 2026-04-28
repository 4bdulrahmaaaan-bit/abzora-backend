const mongoose = require('mongoose');

const garmentTemplateSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: ['shirt', 't-shirt', 'kurta', 'jacket', 'pants'],
      index: true,
    },
    modelUrls: {
      type: {
        lod0: { type: String, trim: true, default: '' },
        lod1: { type: String, trim: true, default: '' },
        lod2: { type: String, trim: true, default: '' },
        preview: { type: String, trim: true, default: '' },
      },
      default: {},
    },
    unity: {
      type: {
        assetBundleUrl: { type: String, trim: true, default: '' },
        sceneKey: { type: String, trim: true, default: '' },
      },
      default: {},
    },
    rigProfile: {
      type: String,
      trim: true,
      default: '',
    },
    blendShapes: {
      type: Map,
      of: Number,
      default: {},
    },
    customizableParts: {
      type: Map,
      of: [String],
      default: {},
    },
    supportedFits: {
      type: [String],
      default: ['slim', 'regular', 'relaxed'],
    },
    defaultMaterialProfile: {
      type: String,
      trim: true,
      default: '',
    },
    defaultColorHex: {
      type: String,
      trim: true,
      default: '#C6A769',
    },
    defaultFabricTextureUrl: {
      type: String,
      trim: true,
      default: '',
    },
    cachePolicy: {
      type: {
        preload: { type: Boolean, default: true },
        ttlSeconds: { type: Number, default: 86400, min: 60 },
      },
      default: {},
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GarmentTemplate', garmentTemplateSchema);

