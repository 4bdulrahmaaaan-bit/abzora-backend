const mongoose = require('mongoose');

const wardrobeOutfitSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      trim: true,
      default: 'Saved Look',
    },
    productIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Product',
      default: [],
      index: true,
    },
    thumbnailUrl: {
      type: String,
      trim: true,
      default: '',
    },
    fitConfidence: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    styleScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true,
    },
    scoreBreakdown: {
      type: {
        fit: { type: Number, default: 0, min: 0, max: 100 },
        style: { type: Number, default: 0, min: 0, max: 100 },
        trend: { type: Number, default: 0, min: 0, max: 100 },
      },
      default: () => ({ fit: 0, style: 0, trend: 0 }),
    },
    scoreExplanation: {
      type: String,
      trim: true,
      default: '',
    },
    fitWarnings: {
      type: [String],
      default: [],
    },
    tags: {
      type: [String],
      default: [],
    },
    lastRetriedAt: {
      type: Date,
      default: null,
    },
    reminderSchedule: {
      type: {
        firstReminderAt: { type: Date, default: null },
        secondReminderAt: { type: Date, default: null },
        thirdReminderAt: { type: Date, default: null },
      },
      default: () => ({ firstReminderAt: null, secondReminderAt: null, thirdReminderAt: null }),
    },
    status: {
      type: String,
      trim: true,
      enum: ['active', 'archived'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
);

wardrobeOutfitSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('WardrobeOutfit', wardrobeOutfitSchema);
