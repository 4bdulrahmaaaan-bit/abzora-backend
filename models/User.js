const mongoose = require('mongoose');

const payoutProfileSchema = new mongoose.Schema(
  {
    methodType: {
      type: String,
      enum: ['', 'bank_account', 'vpa'],
      default: '',
      trim: true,
    },
    accountHolderName: {
      type: String,
      trim: true,
      default: '',
    },
    upiId: {
      type: String,
      trim: true,
      default: '',
    },
    bankAccountNumber: {
      type: String,
      trim: true,
      default: '',
    },
    bankIfsc: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    bankName: {
      type: String,
      trim: true,
      default: '',
    },
    razorpayContactId: {
      type: String,
      trim: true,
      default: '',
    },
    razorpayFundAccountId: {
      type: String,
      trim: true,
      default: '',
    },
    lastSyncedAt: {
      type: String,
      trim: true,
      default: '',
    },
    verificationStatus: {
      type: String,
      enum: ['unverified', 'pending', 'verified', 'failed'],
      default: 'unverified',
    },
    verifiedAt: {
      type: String,
      trim: true,
      default: '',
    },
    verificationReference: {
      type: String,
      trim: true,
      default: '',
    },
    verificationMessage: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false },
);

const onboardingStateSchema = new mongoose.Schema(
  {
    isCompleted: { type: Boolean, default: false },
    status: { type: String, default: 'pending' },
    lastCompletedStep: { type: Number, default: 0 },
    resubmissionRequired: { type: Boolean, default: false },
    resubmissionTarget: { type: String, default: '' },
    requestId: { type: String, default: '' },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    firebaseUid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    uid: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      trim: true,
      default: 'Abianzo Member',
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    profileImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    address: {
      type: String,
      trim: true,
      default: '',
    },
    area: {
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
    liveLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        default: [0, 0], // [lng, lat]
      },
    },
    deliveryRadiusKm: {
      type: Number,
      default: 10,
    },
    locationUpdatedAt: {
      type: String,
      trim: true,
      default: '',
    },
    role: {
      type: String,
      enum: ['user', 'customer', 'vendor', 'rider', 'admin', 'super_admin'],
      default: 'customer',
    },
    activeRole: {
      type: String,
      enum: ['customer', 'vendor', 'rider'],
      default: 'customer'
    },
    lastLoginApp: {
      type: String,
      enum: ['customer', 'vendor', 'rider'],
      default: 'customer'
    },
    lastRoleUpdatedAt: {
      type: Date
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    storeId: {
      type: String,
      trim: true,
      default: '',
    },
    walletBalance: {
      type: Number,
      default: 0,
    },
    referralCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    referredBy: {
      type: String,
      trim: true,
      default: '',
    },
    roles: {
      type: Map,
      of: Boolean,
      default: {},
    },
    riderApprovalStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'suspended'],
      default: 'pending',
    },
    riderVehicleType: {
      type: String,
      trim: true,
      default: '',
    },
    riderLicenseNumber: {
      type: String,
      trim: true,
      default: '',
    },
    riderCity: {
      type: String,
      trim: true,
      default: '',
    },
    riderCapacity: {
      type: Number,
      default: 4,
      min: 1,
      max: 12,
    },
    riderAvailable: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
    payoutProfile: {
      type: payoutProfileSchema,
      default: () => ({}),
    },
    isFlagged: {
      type: Boolean,
      default: false,
      index: true,
    },
    riskScore: {
      type: Number,
      default: 0,
    },
    fraudFlags: {
      type: [String],
      default: [],
    },
    lastKnownIp: {
      type: String,
      trim: true,
      default: '',
    },
    lastKnownUserAgent: {
      type: String,
      trim: true,
      default: '',
    },
    knownDeviceIds: {
      type: [String],
      default: [],
    },
    recentIpAddresses: {
      type: [String],
      default: [],
    },
    userTrialScore: {
      type: Number,
      default: 60,
      min: 0,
      max: 100,
      index: true,
    },
    behaviorMetrics: {
      conversionRate: { type: Number, default: 0, min: 0, max: 1 },
      aov: { type: Number, default: 0, min: 0 },
      returnRate: { type: Number, default: 0, min: 0, max: 1 },
      ctaClickRate: { type: Number, default: 0, min: 0, max: 1 },
      trialUsage: { type: Number, default: 0, min: 0, max: 1 },
      updatedAt: { type: Date, default: Date.now },
    },
    fcmTokens: {
      type: [String],
      default: [],
    },
    vendorOnboarding: {
      type: onboardingStateSchema,
      default: () => ({}),
    },
    riderOnboarding: {
      type: onboardingStateSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ liveLocation: '2dsphere' });

userSchema.pre('validate', function syncFirebaseUid(next) {
  if (!this.firebaseUid && this.uid) {
    this.firebaseUid = this.uid;
  }
  if (!this.uid && this.firebaseUid) {
    this.uid = this.firebaseUid;
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
