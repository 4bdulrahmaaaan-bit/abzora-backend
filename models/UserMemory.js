const mongoose = require('mongoose');

const userMemorySchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    name: {
      type: String,
      trim: true,
      default: '',
    },
    preferredStyle: {
      type: String,
      trim: true,
      default: '',
    },
    size: {
      type: String,
      trim: true,
      default: '',
    },
    pastIssues: {
      type: [String],
      default: [],
    },
    lastOrderId: {
      type: String,
      trim: true,
      default: '',
    },
    lastConversationSummary: {
      type: String,
      trim: true,
      default: '',
    },
    updatedAtIso: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('UserMemory', userMemorySchema);
