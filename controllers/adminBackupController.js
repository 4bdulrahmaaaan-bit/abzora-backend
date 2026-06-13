const AdminBackup = require('../models/AdminBackup');
const adminBackupService = require('../services/adminBackupService');
const { ensureAdmin } = require('./authController');
const AdminActivityLog = require('../models/AdminActivityLog');

async function listBackups(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const backups = await AdminBackup.find({}).sort({ createdAt: -1 }).limit(50);
    res.status(200).json({ success: true, data: backups });
  } catch (error) {
    next(error);
  }
}

async function triggerManualBackup(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const adminEmail = req.user?.email || 'admin@abzora.com';
    
    const backup = await adminBackupService.triggerBackup('manual', adminEmail);

    await AdminActivityLog.create({
      adminEmail,
      action: 'TRIGGER_BACKUP',
      entityType: 'System',
      entityId: backup.backupId,
      notes: 'Manual database backup triggered',
    });

    res.status(200).json({ success: true, data: backup, message: 'Backup started in background' });
  } catch (error) {
    next(error);
  }
}

async function restoreBackup(req, res, next) {
  // As per requirements: "Do not expose mongorestore execution from Admin UI."
  res.status(403).json({ success: false, message: 'Restore operations are not permitted via the Admin UI for security reasons. Please use CLI tools.' });
}

module.exports = {
  listBackups,
  triggerManualBackup,
  restoreBackup,
};
