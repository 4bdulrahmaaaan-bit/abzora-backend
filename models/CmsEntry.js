const mongoose = require('mongoose');

const cmsEntrySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['page', 'faq', 'announcement', 'navigation'],
      required: true,
      index: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    category: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    summary: {
      type: String,
      default: '',
      trim: true,
    },
    content: {
      type: String,
      default: '',
      trim: true,
    },
    image: {
      type: String,
      default: '',
      trim: true,
    },
    linkUrl: {
      type: String,
      default: '',
      trim: true,
    },
    linkLabel: {
      type: String,
      default: '',
      trim: true,
    },
    section: {
      type: String,
      default: '',
      trim: true,
      index: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },
    isFeatured: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    seoTitle: {
      type: String,
      default: '',
      trim: true,
    },
    seoDescription: {
      type: String,
      default: '',
      trim: true,
    },
    publishedAt: {
      type: Date,
      default: null,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

cmsEntrySchema.index(
  { type: 1, slug: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
    },
  }
);

module.exports = mongoose.model('CmsEntry', cmsEntrySchema);
