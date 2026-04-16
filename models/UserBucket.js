const mongoose = require('mongoose');

const userBucketSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    testKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },
    bucket: {
      type: String,
      enum: ['A', 'B', 'C'],
      required: true,
      index: true,
    },
    variantKey: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    assignmentSource: {
      type: String,
      enum: ['deterministic_hash', 'manual_override'],
      default: 'deterministic_hash',
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true, collection: 'user_buckets' },
);

userBucketSchema.index({ userId: 1, testKey: 1 }, { unique: true });

module.exports = mongoose.model('UserBucket', userBucketSchema);
