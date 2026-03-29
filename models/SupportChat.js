const mongoose = require('mongoose');

const supportChatSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      default: 'general',
    },
    status: {
      type: String,
      required: true,
      trim: true,
      default: 'open',
    },
    createdAt: {
      type: String,
      required: true,
      trim: true,
    },
    updatedAt: {
      type: String,
      required: true,
      trim: true,
    },
    lastMessage: {
      type: String,
      trim: true,
      default: '',
    },
    lastMessageAt: {
      type: String,
      trim: true,
      default: '',
    },
    lastSenderId: {
      type: String,
      trim: true,
      default: '',
    },
    lastSenderRole: {
      type: String,
      trim: true,
      default: '',
    },
    userName: {
      type: String,
      trim: true,
      default: '',
    },
    userPhone: {
      type: String,
      trim: true,
      default: '',
    },
    ticketId: {
      type: String,
      trim: true,
      default: '',
    },
    orderId: {
      type: String,
      trim: true,
      default: '',
    },
    unreadCountUser: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadCountAdmin: {
      type: Number,
      default: 0,
      min: 0,
    },
    participantIds: {
      type: Map,
      of: Boolean,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

supportChatSchema.index({ userId: 1, type: 1, status: 1 });

module.exports = mongoose.model('SupportChat', supportChatSchema);
