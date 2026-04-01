const mongoose = require('mongoose');

const outfitItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    role: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const outfitInteractionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    outfitId: {
      type: String,
      trim: true,
      default: '',
      index: true,
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      default: null,
      index: true,
    },
    itemIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Product',
      default: [],
    },
    items: {
      type: [outfitItemSchema],
      default: [],
    },
    filters: {
      type: Object,
      default: {},
    },
    metadata: {
      type: Object,
      default: {},
    },
    createdAtIso: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('OutfitInteraction', outfitInteractionSchema);
