const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
      index: true,
    },
    storeId: {
      type: String,
      trim: true,
      default: '',
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    image: {
      type: String,
      trim: true,
      default: '',
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

wishlistItemSchema.index({ userId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('WishlistItem', wishlistItemSchema);
