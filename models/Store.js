const mongoose = require('mongoose');

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
    description: {
      type: String,
      trim: true,
      default: '',
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
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Store', storeSchema);
