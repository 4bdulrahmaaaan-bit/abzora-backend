const mongoose = require('mongoose');

const conversationMemoryEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    chatId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    entryId: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
      default: 'user',
    },
    text: {
      type: String,
      required: true,
      trim: true,
      default: '',
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

conversationMemoryEntrySchema.index({ userId: 1, chatId: 1, timestamp: -1 });
conversationMemoryEntrySchema.index({ userId: 1, chatId: 1, entryId: 1 }, { unique: true });

module.exports = mongoose.model('ConversationMemoryEntry', conversationMemoryEntrySchema);
