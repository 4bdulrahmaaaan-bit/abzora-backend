const mongoose = require('mongoose');

const pricingAuditLogSchema = new mongoose.Schema(
  {
    auditId: { type: String, required: true, unique: true, trim: true },
    adminId: { type: String, required: true, trim: true },
    adminEmail: { type: String, default: '', trim: true },
    action: { type: String, required: true, trim: true },
    scope: { type: String, required: true, trim: true },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: {} },
    newValue: { type: mongoose.Schema.Types.Mixed, default: {} },
    changedFields: { type: [String], default: [] },
    timestampIso: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model('PricingAuditLog', pricingAuditLogSchema);
