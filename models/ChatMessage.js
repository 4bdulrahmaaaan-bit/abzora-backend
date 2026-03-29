const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema(
  {
    chatId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChatThread',
      required: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
