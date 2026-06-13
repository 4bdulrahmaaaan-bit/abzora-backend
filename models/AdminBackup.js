const mongoose = require('mongoose');

const adminBackupSchema = new mongoose.Schema(
  {
    backupId: { type: String, required: true, unique: true },
    type: { type: String, enum: ['automated', 'manual'], default: 'manual' },
    status: { type: String, enum: ['pending', 'in_progress', 'completed', 'failed'], default: 'pending' },
    fileSizeMb: { type: Number, default: 0 },
    s3Url: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    triggeredBy: { type: String, default: 'system' }, // email or system
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminBackup', adminBackupSchema);
