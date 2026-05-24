const mongoose = require('mongoose');

const tryOnFrameSchema = new mongoose.Schema(
  {
    timestampMs: {
      type: Number,
      default: 0,
    },
    fps: {
      type: Number,
      default: 0,
    },
    poseConfidence: {
      type: Number,
      default: 0,
    },
    bodyVisible: {
      type: Boolean,
      default: false,
    },
    lightingScore: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const tryOnSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    platform: {
      type: String,
      trim: true,
      default: '',
    },
    deviceModel: {
      type: String,
      trim: true,
      default: '',
    },
    cameraFacing: {
      type: String,
      trim: true,
      default: 'front',
    },
    mode: {
      type: String,
      trim: true,
      default: 'live_overlay',
    },
    captureCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    outfitSwitchCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    averageFps: {
      type: Number,
      default: 0,
    },
    peakFps: {
      type: Number,
      default: 0,
    },
    averagePoseConfidence: {
      type: Number,
      default: 0,
    },
    bodyProfileSnapshot: {
      type: Map,
      of: Number,
      default: {},
    },
    measurements: {
      type: Map,
      of: Number,
      default: {},
    },
    renderStats: {
      type: {
        renderer: {
          type: String,
          trim: true,
          default: 'hybrid_2d',
        },
        occlusionEnabled: {
          type: Boolean,
          default: false,
        },
        physicsEnabled: {
          type: Boolean,
          default: false,
        },
        frameSkipCount: {
          type: Number,
          default: 0,
        },
      },
      default: {},
    },
    events: {
      type: [tryOnFrameSchema],
      default: [],
    },
    previewImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      trim: true,
      default: 'active',
    },
    telemetry: {
      type: {
        trackingReliability: { type: Number, default: 0 },
        motionQuality: { type: Number, default: 0 },
        segmentationConfidence: { type: Number, default: 0 },
        thermalLoad: { type: Number, default: 0 },
        sessionQuality: { type: Number, default: 0 },
        fps: { type: Number, default: 0 },
        renderQuality: { type: Number, default: 0 },
      },
      default: {},
    },
    telemetryDashboard: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

tryOnSessionSchema.index({ userId: 1, sessionId: 1 }, { unique: true });

module.exports = mongoose.model('TryOnSession', tryOnSessionSchema);
