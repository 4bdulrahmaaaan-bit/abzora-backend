const mongoose = require('mongoose');

const aiEventLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
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
    },
    message: {
      type: String,
      trim: true,
      default: '',
    },
    prompt: {
      type: String,
      trim: true,
      default: '',
    },
    reason: {
      type: String,
      trim: true,
      default: '',
    },
    intentType: {
      type: String,
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

module.exports = mongoose.model('AiEventLog', aiEventLogSchema);
