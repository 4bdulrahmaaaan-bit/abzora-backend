const fs = require('fs');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

function testPolicyContainsRpoRtoAndOwnership() {
  const content = read('docs/DR_POLICY.md');
  assert(content.includes('RPO'), 'DR policy must define RPO');
  assert(content.includes('RTO'), 'DR policy must define RTO');
  assert(content.toLowerCase().includes('backup owner'), 'DR policy must define backup ownership');
  assert(content.toLowerCase().includes('restore owner'), 'DR policy must define restore ownership');
  assert(content.toLowerCase().includes('escalation path'), 'DR policy must define escalation path');
}

function testRunbookCoverage() {
  const restore = read('docs/BACKUP_RESTORE_RUNBOOK.md');
  assert(restore.includes('Full DB Restore Procedure'), 'Restore runbook must include full DB restore');
  assert(restore.includes('Point-in-Time Recovery Procedure'), 'Restore runbook must include PITR');
  assert(restore.includes('Redis Recovery Procedure'), 'Restore runbook must include Redis recovery');
  assert(restore.includes('Region Failover Procedure'), 'Restore runbook must include region failover');
}

function testDrillCoverage() {
  const drill = read('docs/RESTORE_DRILL_RUNBOOK.md');
  assert(drill.toLowerCase().includes('monthly'), 'Drill runbook must define monthly cadence');
  assert(drill.includes('Validation Checklist'), 'Drill runbook must include validation checklist');
  assert(drill.includes('Integrity Verification'), 'Drill runbook must include integrity verification');
  assert(drill.includes('Drill Rollback Plan'), 'Drill runbook must include rollback plan');
}

function testOperationalRunbooks() {
  const ops = read('docs/INCIDENT_RUNBOOKS.md');
  assert(ops.includes('Mongo Failover Runbook'), 'Ops runbooks must include Mongo failover');
  assert(ops.includes('Redis Outage Runbook'), 'Ops runbooks must include Redis outage');
  assert(ops.includes('Webhook Replay Storm Runbook'), 'Ops runbooks must include webhook replay storm');
  assert(ops.includes('Queue Saturation Runbook'), 'Ops runbooks must include queue saturation');
  assert(ops.includes('Dead-Letter Surge Runbook'), 'Ops runbooks must include dead-letter surge');
}

function testAutomationArtifacts() {
  assert(fs.existsSync(path.join(__dirname, '..', 'scripts', 'verifyBackupReadiness.js')), 'Backup verification script must exist');
  assert(fs.existsSync(path.join(__dirname, '..', 'ops', 'backup', 'backup-status.example.json')), 'Backup status example must exist');
  assert(fs.existsSync(path.join(__dirname, '..', 'ops', 'backup', 'restore-drill-report.example.json')), 'Restore drill report example must exist');
}

function run() {
  testPolicyContainsRpoRtoAndOwnership();
  testRunbookCoverage();
  testDrillCoverage();
  testOperationalRunbooks();
  testAutomationArtifacts();
  // eslint-disable-next-line no-console
  console.log('backup-dr-runbook-safety tests passed');
}

try {
  run();
} catch (error) {
  // eslint-disable-next-line no-console
  console.error('backup-dr-runbook-safety tests failed:', error.message);
  process.exitCode = 1;
}
