/**
 * readinessAudit.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chennai Pilot – Operational Readiness Audit
 *
 * Validates:
 *  1. Database connectivity & collection health
 *  2. Model schema integrity (required fields, indexes)
 *  3. Workflow coverage (orders, trials, KYC, settlements, disputes, refunds)
 *  4. AdminActivityLog coverage for all critical controllers
 *  5. Cache utility availability (node-cache)
 *  6. Automation service (node-cron)
 *  7. Backup service availability
 *  8. Failure resilience checks
 *
 * Usage:
 *   node scripts/readinessAudit.js
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

// ─── Audit infrastructure ─────────────────────────────────────────────────────
const checks = [];
const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️ ';

function check(name, fn, opts = {}) {
  checks.push({ name, fn, critical: opts.critical !== false });
}

async function runChecks() {
  const results = [];
  for (const { name, fn, critical } of checks) {
    try {
      const detail = await fn();
      results.push({ name, status: 'PASS', detail: detail || '', critical });
    } catch (err) {
      results.push({ name, status: critical ? 'FAIL' : 'WARN', detail: err.message, critical });
    }
  }
  return results;
}

// ─── 1. DB Connectivity ───────────────────────────────────────────────────────
check('MongoDB Connection', async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  return `Connected to: ${mongoose.connection.host}`;
});

// ─── 2. Collection Health ─────────────────────────────────────────────────────
const ORDER_COLLECTIONS = [
  'users', 'stores', 'products', 'orders', 'trialhomesessions',
  'vendorkycrequests', 'riderkycrequests', 'settlements', 'refundrequests',
  'admindisputes', 'adminactivitylogs', 'adminnotifications', 'adminautomations',
];

for (const col of ORDER_COLLECTIONS) {
  check(`Collection exists: ${col}`, async () => {
    const count = await mongoose.connection.db.collection(col).estimatedDocumentCount();
    return `${count} documents`;
  });
}

// ─── 3. Index Checks ─────────────────────────────────────────────────────────
check('Orders – status index', async () => {
  // Check both live DB index AND Mongoose schema declaration
  const indexes = await mongoose.connection.db.collection('orders').indexes();
  const hasDbIdx = indexes.some(i => i.key && (i.key.orderStatus || i.key.paymentStatus || i.key.storeId));
  if (hasDbIdx) return 'Index verified in DB';
  // Fall back: check if declared in model file
  const modelContent = fs.readFileSync(path.join(__dirname, '../models/Order.js'), 'utf8');
  if (modelContent.includes('orderStatus') && modelContent.includes('.index(')) return 'Index declared in schema (will sync on next connect)';
  throw new Error('No orderStatus/paymentStatus index found – add for query performance');
}, { critical: false });

check('Products – stock index', async () => {
  const indexes = await mongoose.connection.db.collection('products').indexes();
  const hasDbIdx = indexes.some(i => i.key && i.key.stock !== undefined);
  if (hasDbIdx) return 'Index verified in DB';
  const modelContent = fs.readFileSync(path.join(__dirname, '../models/Product.js'), 'utf8');
  if (modelContent.includes('stock') && modelContent.includes('.index(')) return 'Index declared in schema (will sync on next connect)';
  throw new Error('No stock index – low-stock alerts will be slow');
}, { critical: false });

// ─── 4. Workflow Coverage Checks ─────────────────────────────────────────────
check('Order Lifecycle: pending orders exist', async () => {
  const n = await mongoose.connection.db.collection('orders').countDocuments({ orderStatus: 'pending' });
  return `${n} pending orders`;
}, { critical: false });

check('Trial Lifecycle: active trials exist', async () => {
  const n = await mongoose.connection.db.collection('trialhomesessions').countDocuments({ status: { $in: ['booked', 'active'] } });
  return `${n} active trials`;
}, { critical: false });

check('KYC Workflow: pending vendor KYC', async () => {
  const n = await mongoose.connection.db.collection('vendorkycrequests').countDocuments({ status: 'pending' });
  return `${n} pending vendor KYC requests`;
}, { critical: false });

check('KYC Workflow: pending rider KYC', async () => {
  const n = await mongoose.connection.db.collection('riderkycrequests').countDocuments({ status: 'pending' });
  return `${n} pending rider KYC requests`;
}, { critical: false });

check('Settlement Workflow: pending settlements', async () => {
  const n = await mongoose.connection.db.collection('settlements').countDocuments({ status: 'Pending' });
  return `${n} pending settlements`;
}, { critical: false });

check('Refund Workflow: pending refunds', async () => {
  const n = await mongoose.connection.db.collection('refundrequests').countDocuments({ status: { $in: ['pending', 'requested'] } });
  return `${n} pending refund requests`;
}, { critical: false });

check('Dispute Workflow: open disputes', async () => {
  const n = await mongoose.connection.db.collection('admindisputes').countDocuments({ status: { $ne: 'closed' } });
  return `${n} open disputes`;
}, { critical: false });

// ─── 5. AdminActivityLog Coverage ────────────────────────────────────────────
const REQUIRED_LOG_CONTROLLERS = [
  { file: 'adminKycController.js',          action: 'KYC approval/rejection' },
  { file: 'adminDisputeController.js',       action: 'Dispute resolution' },
  { file: 'adminFraudController.js',         action: 'Fraud flag action' },
  { file: 'adminNotificationController.js',  action: 'Broadcast notification' },
  { file: 'adminInventoryController.js',     action: 'Inventory update' },
  { file: 'adminCouponController.js',        action: 'Coupon create/update' },
  { file: 'adminAutomationController.js',    action: 'Automation toggle' },
  { file: 'adminBackupController.js',        action: 'Backup trigger' },
  { file: 'adminSecurityController.js',      action: 'Session revocation' },
];

const fs = require('fs');
for (const { file, action } of REQUIRED_LOG_CONTROLLERS) {
  check(`AuditLog coverage: ${file} (${action})`, async () => {
    const filePath = path.join(__dirname, '../controllers', file);
    if (!fs.existsSync(filePath)) throw new Error('Controller file not found');
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('AdminActivityLog.create')) {
      throw new Error(`No AdminActivityLog.create call found in ${file}`);
    }
    const callCount = (content.match(/AdminActivityLog\.create/g) || []).length;
    return `${callCount} log entries found`;
  });
}

// Also check controllers that SHOULD have logs but currently don't
const MISSING_LOG_CONTROLLERS = [
  { file: 'adminOrderController.js',    action: 'Order status override' },
  { file: 'adminVendorController.js',   action: 'Vendor action' },
  { file: 'adminFinanceController.js',  action: 'Settlement process' },
  { file: 'adminRiderController.js',    action: 'Rider action' },
];

for (const { file, action } of MISSING_LOG_CONTROLLERS) {
  check(`AuditLog gap: ${file} (${action})`, async () => {
    const filePath = path.join(__dirname, '../controllers', file);
    if (!fs.existsSync(filePath)) return 'Controller not found (no audit gap)';
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('AdminActivityLog.create')) {
      throw new Error(`AUDIT GAP: ${file} has mutating actions without audit logging`);
    }
    return 'Audit logging present';
  }, { critical: false });
}

// ─── 6. Cache Utility ─────────────────────────────────────────────────────────
check('node-cache: module available', async () => {
  const NodeCache = require('node-cache');
  const c = new NodeCache({ stdTTL: 10 });
  c.set('ping', 'pong');
  const v = c.get('ping');
  if (v !== 'pong') throw new Error('Cache set/get failed');
  return 'node-cache functional';
});

check('cache utility: loadable', async () => {
  const cache = require(path.join(__dirname, '../utils/cache'));
  if (!cache || typeof cache.get !== 'function') throw new Error('Cache utility missing get()');
  return 'Cache utility OK';
});

// ─── 7. Automation Service ─────────────────────────────────────────────────────
check('node-cron: module available', async () => {
  const cron = require('node-cron');
  if (typeof cron.schedule !== 'function') throw new Error('node-cron.schedule not a function');
  return 'node-cron module functional';
});

// ─── 8. Backup Service ────────────────────────────────────────────────────────
check('adminBackupService: loadable', async () => {
  const svc = require(path.join(__dirname, '../services/adminBackupService'));
  if (typeof svc.triggerBackup !== 'function') throw new Error('triggerBackup() missing from backup service');
  return 'Backup service loadable';
}, { critical: false });

// ─── 9. Failure Resilience ────────────────────────────────────────────────────
check('Error middleware: present in server.js', async () => {
  const serverPath = path.join(__dirname, '../server.js');
  const content = fs.readFileSync(serverPath, 'utf8');
  // Accept either 'err.' or 'error.' prefix conventions
  const hasErrorMiddleware = content.includes('app.use') && (
    content.includes('err.status') || content.includes('err.message') || content.includes('next(err)') ||
    content.includes('error.status') || content.includes('error.message') || content.includes('error.statusCode')
  );
  if (!hasErrorMiddleware) throw new Error('No error-handling middleware found in server.js');
  return 'Error middleware present';
});

check('Rate limiting: present in server.js or middleware', async () => {
  const serverPath = path.join(__dirname, '../server.js');
  const content = fs.readFileSync(serverPath, 'utf8');
  if (!content.includes('rateLimit') && !content.includes('rate-limit')) {
    throw new Error('Rate limiting not found – 429 protection missing');
  }
  return 'Rate limiting configured';
}, { critical: false });

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ABZORA CHENNAI PILOT – OPERATIONAL READINESS AUDIT');
  console.log(`  Run at: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = await runChecks();

  let passed = 0, failed = 0, warned = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? PASS : r.status === 'WARN' ? WARN : FAIL;
    console.log(`${icon}  ${r.name}`);
    if (r.detail) console.log(`      ${r.detail}`);
    if (r.status === 'PASS') passed++;
    else if (r.status === 'WARN') warned++;
    else failed++;
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  PASS: ${passed}  |  WARN: ${warned}  |  FAIL: ${failed}`);

  const criticalFails = results.filter(r => r.status === 'FAIL' && r.critical);
  if (criticalFails.length === 0) {
    console.log('\n  🟢  GO: All critical checks passed. System is pilot-ready.');
  } else {
    console.log(`\n  🔴  NO-GO: ${criticalFails.length} critical failures must be resolved.`);
    for (const r of criticalFails) console.log(`       • ${r.name}: ${r.detail}`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Save report JSON
  const outPath = path.join(__dirname, '../tmp/readiness_audit.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ timestamp: new Date().toISOString(), passed, warned, failed, results }, null, 2));
  console.log(`  📄 Full audit report saved to: ${outPath}`);

  if (mongoose.connection.readyState === 1) await mongoose.disconnect();
  process.exit(criticalFails.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('❌  Audit runner failed:', err.message);
  process.exit(1);
});
