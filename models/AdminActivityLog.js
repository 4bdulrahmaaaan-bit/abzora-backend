const mongoose = require('mongoose');

const adminActivityLogSchema = new mongoose.Schema(
  {
    logId: { type: String, required: true, unique: true, trim: true },
    actorId: { type: String, required: true, trim: true },
    actorRole: { type: String, required: true, trim: true },
    action: { type: String, required: true, trim: true },
    targetType: { type: String, required: true, trim: true },
    targetId: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    timestampIso: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminActivityLog', adminActivityLogSchema);
