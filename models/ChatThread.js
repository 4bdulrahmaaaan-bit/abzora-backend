const mongoose = require('mongoose');

const chatThreadSchema = new mongoose.Schema(
  {
    participantIds: {
      type: [String],
      required: true,
      default: [],
      index: true,
    },
    otherUserName: {
      type: String,
      trim: true,
      default: 'Abzora Support',
    },
    lastMessage: {
      type: String,
      trim: true,
      default: '',
    },
    lastTimestamp: {
      type: String,
      trim: true,
      default: '',
    },
    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    isVerified: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ChatThread', chatThreadSchema);
