const mongoose = require('mongoose');

const adminNotificationSchema = new mongoose.Schema(
  {
    notificationId: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    type: { type: String, default: 'general', trim: true },
    isRead: { type: Boolean, default: false },
    timestamp: { type: String, required: true, trim: true },
    audienceRole: { type: String, default: 'user', trim: true },
    userId: { type: String, default: '', trim: true },
    storeId: { type: String, default: '', trim: true },
    entityId: { type: String, default: '', trim: true },
    entityType: { type: String, default: '', trim: true },
    targetRoute: { type: String, default: '', trim: true },
    campaignType: { type: String, enum: ['Instant', 'Scheduled', 'Segmented'], default: 'Instant' },
    channels: { type: [String], default: ['Push'] },
    analytics: {
      type: mongoose.Schema.Types.Mixed,
      default: { sent: 0, delivered: 0, failed: 0, openRate: 0 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminNotification', adminNotificationSchema);
