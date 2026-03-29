const mongoose = require('mongoose');

const supportResponseCacheSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    cacheKey: {
      type: String,
      required: true,
      trim: true,
    },
    response: {
      type: String,
      required: true,
      trim: true,
      default: '',
    },
    intent: {
      type: String,
      required: true,
      trim: true,
      default: 'aiNeeded',
    },
    updatedAtLabel: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

supportResponseCacheSchema.index({ userId: 1, cacheKey: 1 }, { unique: true });

module.exports = mongoose.model('SupportResponseCache', supportResponseCacheSchema);
