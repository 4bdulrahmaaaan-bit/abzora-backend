const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ageMinutes(iso) {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return (Date.now() - ts) / 60000;
}

function run() {
  const statusPath = path.join(__dirname, '..', 'ops', 'backup', 'backup-status.json');
  if (!fs.existsSync(statusPath)) {
    throw new Error(`Missing backup status file: ${statusPath}`);
  }
  const payload = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  const mongoSnapshotMaxAgeMin = Number(process.env.BACKUP_VERIFY_MONGO_SNAPSHOT_MAX_AGE_MIN || 180);
  const mongoPitrMaxAgeMin = Number(process.env.BACKUP_VERIFY_MONGO_PITR_MAX_AGE_MIN || 15);
  const redisAofMaxAgeMin = Number(process.env.BACKUP_VERIFY_REDIS_AOF_MAX_AGE_MIN || 180);
  const drillMaxAgeDays = Number(process.env.BACKUP_VERIFY_DRILL_MAX_AGE_DAYS || 40);

  assert(payload.mongo?.snapshotStatus === 'ok', 'Mongo snapshot status is not ok');
  assert(payload.mongo?.pitrStatus === 'ok', 'Mongo PITR status is not ok');
  assert(payload.redis?.status === 'ok', 'Redis backup status is not ok');

  assert(ageMinutes(payload.mongo?.lastSnapshotAtIso) <= mongoSnapshotMaxAgeMin, 'Mongo snapshot is stale');
  assert(ageMinutes(payload.mongo?.lastPitrCheckpointAtIso) <= mongoPitrMaxAgeMin, 'Mongo PITR checkpoint is stale');
  assert(ageMinutes(payload.redis?.lastAofArchiveAtIso) <= redisAofMaxAgeMin, 'Redis AOF archive is stale');

  const drillPath = path.join(__dirname, '..', 'ops', 'backup', 'restore-drill-report.json');
  assert(fs.existsSync(drillPath), `Missing restore drill report: ${drillPath}`);
  const drill = JSON.parse(fs.readFileSync(drillPath, 'utf8'));
  const drillAgeDays = ageMinutes(drill.executedAtIso) / (60 * 24);
  assert(drillAgeDays <= drillMaxAgeDays, 'Restore drill report is too old');
  assert(drill.result === 'pass', 'Latest restore drill did not pass');

  // eslint-disable-next-line no-console
  console.log('backup-readiness verification passed');
}

try {
  run();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('backup-readiness verification failed:', error.message);
  process.exitCode = 1;
}
