const mongoose = require('mongoose');

const reviewReplySchema = new mongoose.Schema(
  {
    reviewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Review',
      required: true,
      index: true,
    },
    vendorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
    collection: 'review_replies',
  }
);

module.exports = mongoose.model('ReviewReply', reviewReplySchema);
