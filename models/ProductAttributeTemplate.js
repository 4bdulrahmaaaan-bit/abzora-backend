const mongoose = require('mongoose');

const attributeFieldSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      trim: true,
      required: true,
    },
    label: {
      type: String,
      trim: true,
      required: true,
    },
    type: {
      type: String,
      trim: true,
      default: 'text',
    },
    required: {
      type: Boolean,
      default: false,
    },
    readOnly: {
      type: Boolean,
      default: false,
    },
    filterable: {
      type: Boolean,
      default: true,
    },
    variantSupport: {
      type: Boolean,
      default: false,
    },
    unit: {
      type: String,
      trim: true,
      default: '',
    },
    options: {
      type: [String],
      default: [],
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { _id: false },
);

const attributeSectionSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      required: true,
    },
    fields: {
      type: [attributeFieldSchema],
      default: [],
    },
  },
  { _id: false },
);

const productAttributeTemplateSchema = new mongoose.Schema(
  {
    templateKey: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      index: true,
    },
    label: {
      type: String,
      trim: true,
      required: true,
    },
    categoryKey: {
      type: String,
      trim: true,
      default: 'generic',
      index: true,
    },
    subcategoryMatch: {
      type: String,
      trim: true,
      default: '',
    },
    version: {
      type: Number,
      default: 1,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    isSystem: {
      type: Boolean,
      default: false,
    },
    sections: {
      type: [attributeSectionSchema],
      default: [],
    },
    createdBy: {
      type: String,
      trim: true,
      default: '',
    },
    updatedBy: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('ProductAttributeTemplate', productAttributeTemplateSchema);
