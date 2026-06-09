const mongoose = require('mongoose');

const vendorNotificationSchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true, trim: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: { type: String, default: 'general', trim: true },
    priority: { type: String, enum: ['low', 'normal', 'high', 'critical'], default: 'normal' },
    isRead: { type: Boolean, default: false },
    entityId: { type: String, default: '', trim: true },
    entityType: { type: String, default: '', trim: true },
    targetRoute: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

vendorNotificationSchema.index({ vendorId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('VendorNotification', vendorNotificationSchema);
