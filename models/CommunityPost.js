const mongoose = require('mongoose');

const communityPostSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    lookShareId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LookShare',
      default: null,
      index: true,
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    caption: {
      type: String,
      trim: true,
      default: '',
    },
    productIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Product',
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    likedBy: {
      type: [String],
      default: [],
    },
    likeCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    commentCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      trim: true,
      default: 'active',
      enum: ['active', 'hidden'],
      index: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('CommunityPost', communityPostSchema);
