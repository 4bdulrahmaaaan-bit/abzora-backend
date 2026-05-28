const mongoose = require('mongoose');

const authSessionSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    platform: {
      type: String,
      default: 'unknown',
      trim: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      trim: true,
    },
    refreshTokenExpiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    accessTokenVersion: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

authSessionSchema.index({ userId: 1, deviceId: 1 });
authSessionSchema.index({ refreshTokenExpiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('AuthSession', authSessionSchema);
