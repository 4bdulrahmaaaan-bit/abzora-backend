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
      default: 'ABZORA Member',
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
    isActive: {
      type: Boolean,
      default: true,
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
    lastLoginAt: {
      type: Date,
      default: Date.now,
    },
    payoutProfile: {
      type: payoutProfileSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

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
