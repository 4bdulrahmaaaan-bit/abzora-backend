const assert = require('assert');

const { buildInvoiceSnapshotHash } = require('../services/invoiceNumberService');
const { verifySignedToken, buildSignedToken } = require('../services/invoiceSigningService');

function run() {
  const a = { invoiceNumber: 'ABZ-2026-1', grandTotal: 100 };
  const b = { invoiceNumber: 'ABZ-2026-1', grandTotal: 100 };
  const c = { invoiceNumber: 'ABZ-2026-1', grandTotal: 101 };
  const hashA = buildInvoiceSnapshotHash(a);
  const hashB = buildInvoiceSnapshotHash(b);
  const hashC = buildInvoiceSnapshotHash(c);
  assert.strictEqual(hashA, hashB, 'Snapshot hash must be deterministic');
  assert.notStrictEqual(hashA, hashC, 'Snapshot hash must change when payload changes');

  const token = buildSignedToken({
    invoiceId: 'inv-1',
    userId: 'u-1',
    role: 'customer',
    version: 'v2',
    expiresAt: Date.now() + 60_000,
  });
  const verified = verifySignedToken(token);
  assert.strictEqual(verified.valid, true, 'Signed token must verify');
  assert.strictEqual(verified.version, 'v2', 'Version must round-trip in token payload');
  console.log('invoice-hardening-smoke.test: ok');
}

run();
