const mongoose = require('mongoose');

const garmentConfigSchema = new mongoose.Schema(
  {
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GarmentTemplate',
      required: true,
      index: true,
    },
    fabricTextureUrl: {
      type: String,
      trim: true,
      default: '',
    },
    normalMapUrl: {
      type: String,
      trim: true,
      default: '',
    },
    fitPreset: {
      type: String,
      enum: ['slim', 'regular', 'relaxed', 'oversized', 'athletic'],
      default: 'regular',
      index: true,
    },
    colorHex: {
      type: String,
      trim: true,
      default: '#C6A769',
    },
    designOptions: {
      type: Map,
      of: String,
      default: {},
    },
    blendShapes: {
      type: Map,
      of: Number,
      default: {},
    },
    lodPreference: {
      type: String,
      enum: ['auto', 'low', 'medium', 'high'],
      default: 'auto',
    },
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GarmentConfig', garmentConfigSchema);
