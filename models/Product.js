const mongoose = require('mongoose');

const trialHomeConfigSchema = new mongoose.Schema(
  {
    trialEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    allowedLocations: {
      type: [String],
      default: [],
    },
    trialLimitPerDay: {
      type: Number,
      default: 20,
      min: 1,
      max: 500,
    },
    trialFee: {
      type: Number,
      default: 99,
      min: 0,
      max: 5000,
    },
    approvalMode: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'auto',
    },
  },
  { _id: false },
);

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    brand: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    images: {
      type: [String],
      default: [],
    },
    model3d: {
      type: String,
      trim: true,
      default: '',
    },
    unityAssetBundleUrl: {
      type: String,
      trim: true,
      default: '',
    },
    rigProfile: {
      type: String,
      trim: true,
      default: '',
    },
    materialProfile: {
      type: String,
      trim: true,
      default: '',
    },
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Store',
      required: true,
      index: true,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    subcategory: {
      type: String,
      trim: true,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    sizes: {
      type: [String],
      default: ['S', 'M', 'L'],
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    demandScore: {
      type: Number,
      default: 0,
    },
    viewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    cartCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    purchaseCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    outfitType: {
      type: String,
      trim: true,
      default: '',
    },
    fabric: {
      type: String,
      trim: true,
      default: '',
    },
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
    arAsset: {
      type: {
        status: {
          type: String,
          trim: true,
          default: '',
        },
        category: {
          type: String,
          trim: true,
          default: '',
        },
        sourceImage: {
          type: String,
          trim: true,
          default: '',
        },
        transparentImage: {
          type: String,
          trim: true,
          default: '',
        },
        processedImage: {
          type: String,
          trim: true,
          default: '',
        },
        anchors: {
          left_shoulder: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 },
          },
          right_shoulder: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 },
          },
          center: {
            x: { type: Number, default: 0 },
            y: { type: Number, default: 0 },
          },
        },
        categoryTemplate: {
          type: String,
          trim: true,
          default: '',
        },
        scaleFactor: {
          type: Number,
          default: 1,
        },
        normalization: {
          type: {
            widthFactor: { type: Number, default: 1 },
            heightFactor: { type: Number, default: 1 },
            maintainAspectRatio: { type: Boolean, default: true },
            centered: { type: Boolean, default: true },
            upright: { type: Boolean, default: true },
          },
          default: {},
        },
        segmentation: {
          type: {
            targetRegion: { type: String, default: 'torso' },
            confidence: { type: Number, default: 0 },
            method: { type: String, default: '' },
          },
          default: {},
        },
        fallbackMode: {
          type: String,
          trim: true,
          default: '',
        },
        failureReason: {
          type: String,
          trim: true,
          default: '',
        },
        pipelineVersion: {
          type: String,
          trim: true,
          default: '',
        },
        generatedAt: {
          type: Date,
          default: null,
        },
      },
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    trialHome: {
      type: trialHomeConfigSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Product', productSchema);
