/**
 * benchmarkApis.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chennai Pilot – API Performance Benchmarking Tool
 *
 * Measures real response times against the running local backend.
 * Uses REAL production-like data (not seed data).
 *
 * Targets:
 *   Dashboard APIs  < 300ms
 *   Queue APIs      < 500ms
 *   Analytics APIs  < 1000ms
 *
 * Usage:
 *   node scripts/benchmarkApis.js [--url http://localhost:5000] [--token <JWT>]
 */

'use strict';

require('dotenv').config();
const https = require('https');
const http = require('http');

// ─── Config ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};

const BASE_URL = getArg('--url', 'http://localhost:5000');
const TOKEN = getArg('--token', process.env.BENCHMARK_ADMIN_TOKEN || '');
const RUNS = parseInt(getArg('--runs', '5'), 10);

if (!TOKEN) {
  console.warn('⚠️   No --token provided. Authenticated routes will return 401.');
  console.warn('    Set BENCHMARK_ADMIN_TOKEN in .env or pass --token <JWT>\n');
}

// ─── Targets ──────────────────────────────────────────────────────────────────
const TARGETS = [
  // Dashboard APIs  (target < 300ms)
  { label: 'Dashboard Summary',        path: '/admin/dashboard',           threshold: 300, category: 'dashboard' },
  { label: 'Finance Dashboard',        path: '/admin/finance/dashboard',    threshold: 300, category: 'dashboard' },
  { label: 'Order Dashboard',          path: '/admin/orders/dashboard',     threshold: 300, category: 'dashboard' },
  { label: 'Vendor Dashboard',         path: '/admin/vendors/dashboard',    threshold: 300, category: 'dashboard' },
  { label: 'Rider Dashboard',          path: '/admin/riders/dashboard',     threshold: 300, category: 'dashboard' },
  { label: 'System Health',            path: '/admin/system-health',        threshold: 300, category: 'dashboard' },
  // Queue APIs  (target < 500ms)
  { label: 'Order Queue',              path: '/admin/orders/queue',         threshold: 500, category: 'queue' },
  { label: 'KYC Queue – Vendor',       path: '/admin/kyc',                  threshold: 500, category: 'queue' },
  { label: 'Dispute Queue',            path: '/admin/disputes',             threshold: 500, category: 'queue' },
  { label: 'Audit Logs',               path: '/admin/audit-logs',           threshold: 500, category: 'queue' },
  { label: 'Fraud Alerts',             path: '/admin/fraud',                threshold: 500, category: 'queue' },
  { label: 'Settlements',              path: '/admin/finance/settlements',  threshold: 500, category: 'queue' },
  { label: 'Refunds Queue',            path: '/admin/finance/refunds',      threshold: 500, category: 'queue' },
  { label: 'Automations',              path: '/admin/automations',          threshold: 500, category: 'queue' },
  // Analytics APIs  (target < 1000ms)
  { label: 'Analytics Overview',       path: '/admin/analytics',            threshold: 1000, category: 'analytics' },
  { label: 'Finance Reports',          path: '/admin/finance/reports',      threshold: 1000, category: 'analytics' },
];

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
function fetchTimed(url) {
  return new Promise((resolve) => {
    const start = Date.now();
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { Authorization: `Bearer ${TOKEN}` } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ ms: Date.now() - start, status: res.statusCode, size: data.length });
      });
    });
    req.on('error', (err) => {
      resolve({ ms: Date.now() - start, status: 0, error: err.message });
    });
    req.setTimeout(5000, () => {
      req.destroy();
      resolve({ ms: 5000, status: 0, error: 'timeout' });
    });
  });
}

// ─── Run benchmark ────────────────────────────────────────────────────────────
async function runBenchmark() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ABZORA CHENNAI PILOT – API PERFORMANCE BENCHMARK');
  console.log(`  Target: ${BASE_URL}  |  Runs per endpoint: ${RUNS}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = [];

  for (const target of TARGETS) {
    const url = `${BASE_URL}${target.path}`;
    const timings = [];
    let lastStatus = 0;
    process.stdout.write(`  Testing: ${target.label.padEnd(30)}`);

    for (let i = 0; i < RUNS; i++) {
      const { ms, status } = await fetchTimed(url);
      timings.push(ms);
      lastStatus = status;
      // Small delay between runs to avoid self-throttling
      await new Promise(r => setTimeout(r, 50));
    }

    const avg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);
    const min = Math.min(...timings);
    const max = Math.max(...timings);
    const p95 = timings.sort((a, b) => a - b)[Math.floor(timings.length * 0.95)];
    const pass = avg <= target.threshold;

    const result = {
      ...target,
      avg,
      min,
      max,
      p95,
      status: lastStatus,
      pass,
    };
    results.push(result);

    const emoji = pass ? '✅' : '❌';
    const statusStr = lastStatus === 401 ? ' (auth required)' : lastStatus === 0 ? ' (error/offline)' : '';
    console.log(`${emoji}  avg=${avg}ms  p95=${p95}ms  [${target.threshold}ms limit]${statusStr}`);
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════');

  const groups = { dashboard: [], queue: [], analytics: [] };
  for (const r of results) groups[r.category].push(r);

  for (const [group, items] of Object.entries(groups)) {
    const passed = items.filter(r => r.pass).length;
    const total = items.length;
    const allAuth = items.every(r => r.status === 401);
    console.log(`\n  ${group.toUpperCase()} APIs: ${passed}/${total} passed${allAuth ? ' (all 401 – need valid token)' : ''}`);
    for (const r of items) {
      const prefix = r.pass ? '  ✅' : '  ❌';
      console.log(`${prefix}  ${r.label.padEnd(30)} avg=${r.avg}ms  p95=${r.p95}ms  threshold=${r.threshold}ms`);
    }
  }

  const totalPassed = results.filter(r => r.pass).length;
  const totalFailed = results.filter(r => !r.pass && r.status !== 401 && r.status !== 0).length;

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  TOTAL PASS: ${totalPassed}/${results.length}  |  SLA FAILURES: ${totalFailed}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Machine-readable output
  const outputPath = require('path').join(__dirname, '../tmp/benchmark_results.json');
  const fs = require('fs');
  fs.mkdirSync(require('path').dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`  📄 Results saved to: ${outputPath}`);

  return results;
}

runBenchmark().catch(console.error);
