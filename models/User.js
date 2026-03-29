const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    uid: {
      type: String,
      required: true,
      unique: true,
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
      default: 'user',
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('User', userSchema);
