const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportChat',
      required: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
      trim: true,
    },
    senderRole: {
      type: String,
      required: true,
      trim: true,
      default: 'user',
    },
    text: {
      type: String,
      trim: true,
      default: '',
    },
    imageUrl: {
      type: String,
      trim: true,
      default: '',
    },
    timestamp: {
      type: String,
      required: true,
      trim: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
