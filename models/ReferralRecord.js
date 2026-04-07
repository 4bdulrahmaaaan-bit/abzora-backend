const mongoose = require('mongoose');

const referralRecordSchema = new mongoose.Schema(
  {
    referrerId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    referredUserId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    referralCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'blocked'],
      default: 'pending',
    },
    rewardGiven: {
      type: Boolean,
      default: false,
    },
    referrerReward: {
      type: Number,
      default: 0,
    },
    friendReward: {
      type: Number,
      default: 0,
    },
    createdAtIso: {
      type: String,
      trim: true,
      default: '',
    },
    completedAt: {
      type: String,
      trim: true,
      default: '',
    },
    qualifyingOrderId: {
      type: String,
      trim: true,
      default: '',
    },
    qualifyingOrderAmount: {
      type: Number,
      default: null,
    },
    fraudFlags: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

referralRecordSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true });

module.exports = mongoose.model('ReferralRecord', referralRecordSchema);
