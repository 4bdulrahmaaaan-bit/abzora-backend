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

const atelierCustomizationSchema = new mongoose.Schema(
  {
    customizable: {
      type: Boolean,
      default: false,
      index: true,
    },
    atelierEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    fabricOptions: {
      type: [String],
      default: [],
    },
    colorOptions: {
      type: [String],
      default: [],
    },
    styleVariants: {
      type: [String],
      default: [],
    },
    addOnOptions: {
      type: [String],
      default: [],
    },
    allowedMeasurementOptions: {
      type: [String],
      default: [],
      enum: ['manual', 'trial', 'visit', 'standard'],
    },
    baseTailoringCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
    homeVisitCharge: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

const garmentConfigSchema = new mongoose.Schema(
  {
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GarmentTemplate',
      default: null,
      index: true,
    },
    fabricTextureUrl: {
      type: String,
      trim: true,
      default: '',
    },
    fitPreset: {
      type: String,
      trim: true,
      default: 'regular',
      enum: ['slim', 'regular', 'relaxed', 'oversized', 'athletic'],
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
    blendShapeOverrides: {
      type: Map,
      of: Number,
      default: {},
    },
    lodPreference: {
      type: String,
      trim: true,
      default: 'auto',
      enum: ['auto', 'low', 'medium', 'high'],
    },
  },
  { _id: false },
);

const boutiqueInfoSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      default: '',
    },
    logoUrl: {
      type: String,
      trim: true,
      default: '',
    },
    verified: {
      type: Boolean,
      default: false,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    ctaLabel: {
      type: String,
      trim: true,
      default: 'View Store',
    },
  },
  { _id: false },
);

const deliveryInfoSchema = new mongoose.Schema(
  {
    sameDayEligible: {
      type: Boolean,
      default: true,
    },
    freeReturns: {
      type: Boolean,
      default: true,
    },
    cashOnDelivery: {
      type: Boolean,
      default: true,
    },
    etaLabel: {
      type: String,
      trim: true,
      default: '',
    },
    countdownMinutes: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false },
);

const colorVariantSchema = new mongoose.Schema(
  {
    variantId: {
      type: String,
      trim: true,
      default: '',
    },
    productId: {
      type: String,
      trim: true,
      default: '',
    },
    colorName: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    hex: {
      type: String,
      trim: true,
      default: '#C6A769',
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    sku: {
      type: String,
      trim: true,
      default: '',
    },
    barcode: {
      type: String,
      trim: true,
      default: '',
    },
    price: {
      type: Number,
      default: null,
      min: 0,
    },
    discountPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    stock: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      trim: true,
      default: 'active',
    },
    thumbnail: {
      type: String,
      trim: true,
      default: '',
    },
    images: {
      type: [String],
      default: [],
    },
    sizes: {
      type: [String],
      default: [],
    },
    sizeStocks: {
      type: [
        {
          sizeName: {
            type: String,
            trim: true,
            default: '',
          },
          stockQuantity: {
            type: Number,
            default: 0,
            min: 0,
          },
        },
      ],
      default: [],
    },
    deliveryInfo: {
      type: deliveryInfoSchema,
      default: () => ({}),
    },
    createdAt: {
      type: Date,
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false },
);

const socialProofSchema = new mongoose.Schema(
  {
    viewersToday: {
      type: Number,
      default: 0,
      min: 0,
    },
    ordersThisWeek: {
      type: Number,
      default: 0,
      min: 0,
    },
    wishlistCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    purchasesText: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false },
);

const structuredAttributeSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      trim: true,
      default: '',
    },
    label: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      trim: true,
      default: 'text',
    },
    required: {
      type: Boolean,
      default: false,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    filterable: {
      type: Boolean,
      default: true,
    },
    variantSupport: {
      type: Boolean,
      default: false,
    },
    unit: {
      type: String,
      trim: true,
      default: '',
    },
    options: {
      type: [String],
      default: [],
    },
    section: {
      type: String,
      trim: true,
      default: '',
    },
    order: {
      type: Number,
      default: 0,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
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
    originalPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    discountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 99,
    },
    isDiscountActive: {
      type: Boolean,
      default: false,
      index: true,
    },
    discountStartDate: {
      type: Date,
      default: null,
    },
    discountEndDate: {
      type: Date,
      default: null,
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
    assetBundleUrl: {
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
    attributeTemplateKey: {
      type: String,
      trim: true,
      default: 'generic',
      index: true,
    },
    attributeTemplateVersion: {
      type: Number,
      default: 1,
      min: 1,
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
    highlights: {
      type: [String],
      default: [],
    },
    boutiqueInfo: {
      type: boutiqueInfoSchema,
      default: () => ({}),
    },
    colorVariants: {
      type: [colorVariantSchema],
      default: [],
    },
    deliveryInfo: {
      type: deliveryInfoSchema,
      default: () => ({}),
    },
    socialProof: {
      type: socialProofSchema,
      default: () => ({}),
    },
    specifications: {
      type: Map,
      of: String,
      default: {},
    },
    completeLookProductIds: {
      type: [String],
      default: [],
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
    fitRisk: {
      type: Number,
      default: 0.35,
      min: 0,
      max: 1,
      index: true,
    },
    sameDayEligible: {
      type: Boolean,
      default: true,
      index: true,
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
    structuredAttributes: {
      type: [structuredAttributeSchema],
      default: [],
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
    atelier: {
      type: atelierCustomizationSchema,
      default: () => ({}),
    },
    garmentConfig: {
      type: garmentConfigSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

productSchema.index({ category: 1, subcategory: 1, isActive: 1 });
productSchema.index({ brand: 1, category: 1 });
productSchema.index({ name: 'text', brand: 'text', description: 'text' });
productSchema.index({ stock: 1, isActive: 1 });


module.exports = mongoose.model('Product', productSchema);

