const mongoose = require('mongoose');

const customVendorMetricsSchema = new mongoose.Schema(
  {
    orderSuccessRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    delayRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    returnRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    totalCustomOrders: {
      type: Number,
      default: 0,
      min: 0,
    },
    completedCustomOrders: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const customVendorQualitySchema = new mongoose.Schema(
  {
    qualityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    fitSuccessRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    onTimeDeliveryRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    customerQualityRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    customerFitRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    customerDeliveryRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    adminQaPassRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    visibilityTier: {
      type: String,
      enum: ['elite', 'trusted', 'watchlist', 'risk'],
      default: 'watchlist',
    },
  },
  { _id: false }
);

const customVendorProfileSchema = new mongoose.Schema(
  {
    experienceYears: {
      type: Number,
      default: 0,
      min: 0,
    },
    specializations: {
      type: [String],
      default: [],
    },
    portfolioImages: {
      type: [String],
      default: [],
    },
    priceRangeMin: {
      type: Number,
      default: 0,
      min: 0,
    },
    priceRangeMax: {
      type: Number,
      default: 0,
      min: 0,
    },
    productionTimeDays: {
      type: Number,
      default: 7,
      min: 1,
    },
    qualityApprovalRequired: {
      type: Boolean,
      default: false,
    },
    supportsAlterations: {
      type: Boolean,
      default: true,
    },
    alterationPolicy: {
      type: String,
      trim: true,
      default: '',
    },
    qualityTier: {
      type: String,
      enum: ['normal', 'watchlist', 'restricted', 'suspended'],
      default: 'normal',
    },
    penaltyPoints: {
      type: Number,
      default: 0,
      min: 0,
    },
    activeCustomOrderLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    metrics: {
      type: customVendorMetricsSchema,
      default: () => ({}),
    },
    quality: {
      type: customVendorQualitySchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const sameDayConfigSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    cutoffHour: {
      type: Number,
      default: 16,
      min: 0,
      max: 23,
    },
    prepTimeMins: {
      type: Number,
      default: 60,
      min: 10,
      max: 600,
    },
    supportsTrialHome: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false },
);

const storeSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      unique: true,
      sparse: true,
      index: true,
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
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
    isFeatured: {
      type: Boolean,
      default: false,
    },
    approvalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'approved',
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    vendorType: {
      type: String,
      enum: ['standard_vendor', 'custom_vendor'],
      default: 'standard_vendor',
      index: true,
    },
    commissionRate: {
      type: Number,
      default: 0.12,
      min: 0,
      max: 0.5,
    },
    walletBalance: {
      type: Number,
      default: 0,
      min: 0,
    },
    logoUrl: {
      type: String,
      trim: true,
      default: '',
    },
    bannerImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    latitude: {
      type: Number,
      default: null,
    },
    longitude: {
      type: Number,
      default: null,
    },
    geoLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    tagline: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    customVendorProfile: {
      type: customVendorProfileSchema,
      default: () => ({}),
    },
    sameDay: {
      type: sameDayConfigSchema,
      default: () => ({}),
    },
    operationalSpeedScore: {
      type: Number,
      default: 50,
      min: 0,
      max: 100,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

storeSchema.index({ geoLocation: '2dsphere' });

module.exports = mongoose.model('Store', storeSchema);
