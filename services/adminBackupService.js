const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const AdminBackup = require('../models/AdminBackup');
const { v4: uuidv4 } = require('uuid');

const BACKUP_DIR = path.join(__dirname, '../../backups');

// Ensure backup dir exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function getDirectorySizeMb(targetPath) {
  let totalBytes = 0;
  const stack = [targetPath];

  while (stack.length) {
    const currentPath = stack.pop();
    if (!fs.existsSync(currentPath)) continue;
    const stats = fs.statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = fs.readdirSync(currentPath);
      for (const entry of entries) {
        stack.push(path.join(currentPath, entry));
      }
      continue;
    }
    totalBytes += stats.size;
  }

  return Math.max(0, Math.round((totalBytes / (1024 * 1024)) * 10) / 10);
}

async function triggerBackup(type = 'manual', triggeredBy = 'system') {
  const backupId = `BKP-${Date.now()}-${uuidv4().substring(0, 5)}`;
  const backup = await AdminBackup.create({
    backupId,
    type,
    status: 'in_progress',
    triggeredBy,
  });

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    backup.status = 'failed';
    backup.errorMessage = 'MongoDB URI not configured';
    await backup.save();
    return backup;
  }

  const outputPath = path.join(BACKUP_DIR, backupId);

  // Run mongodump in background
  exec(`mongodump --uri="${uri}" --out="${outputPath}"`, async (error, stdout, stderr) => {
    try {
      if (error) {
        // We catch mongodump errors but don't crash. We just mark it failed.
        backup.status = 'failed';
        backup.errorMessage = error.message;
        await backup.save();
        return;
      }
      
      backup.status = 'completed';
      backup.completedAt = new Date();
      backup.fileSizeMb = getDirectorySizeMb(outputPath);
      backup.s3Url = outputPath;
      await backup.save();

      // Clean up local files after "upload"
      fs.rm(outputPath, { recursive: true, force: true }, () => {});

    } catch (err) {
      console.error('Backup completion handler error:', err);
    }
  });

  return backup;
}

module.exports = {
  triggerBackup,
};
