const mongoose = require('mongoose');

const influencerLookSchema = new mongoose.Schema(
  {
    influencerId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    influencerName: {
      type: String,
      trim: true,
      default: '',
    },
    influencerHandle: {
      type: String,
      trim: true,
      default: '',
    },
    title: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    coverImageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    productIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Product',
      default: [],
    },
    styleTags: {
      type: [String],
      default: [],
    },
    occasionTags: {
      type: [String],
      default: [],
    },
    ctaLabel: {
      type: String,
      trim: true,
      default: 'Try This Look',
    },
    isTrending: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    priority: {
      type: Number,
      default: 0,
      index: true,
    },
    stats: {
      type: {
        tryCount: { type: Number, default: 0, min: 0 },
        shareCount: { type: Number, default: 0, min: 0 },
      },
      default: () => ({ tryCount: 0, shareCount: 0 }),
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('InfluencerLook', influencerLookSchema);
