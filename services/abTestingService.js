const crypto = require('crypto');

const ABTest = require('../models/ABTest');
const UserBucket = require('../models/UserBucket');

const DEFAULT_TESTS = [
  {
    testKey: 'CTA_VARIANT',
    name: 'CTA Variant Test',
    dimension: 'cta',
    variants: [
      { key: 'BUY_NOW', weight: 34 },
      { key: 'TRY_HOME', weight: 33 },
      { key: 'HYBRID', weight: 33 },
    ],
  },
  {
    testKey: 'URGENCY_LEVEL',
    name: 'Urgency Messaging Test',
    dimension: 'urgency',
    variants: [
      { key: 'NONE', weight: 34 },
      { key: 'SOFT', weight: 33 },
      { key: 'HIGH', weight: 33 },
    ],
  },
  {
    testKey: 'CHECKOUT_FLOW',
    name: 'Checkout Flow Test',
    dimension: 'checkoutMode',
    variants: [
      { key: 'INSTANT', weight: 50 },
      { key: 'STANDARD', weight: 50 },
    ],
  },
  {
    testKey: 'LOGIN_GATE',
    name: 'Login Timing Test',
    dimension: 'login',
    variants: [
      { key: 'EARLY', weight: 34 },
      { key: 'DELAYED', weight: 33 },
      { key: 'GUEST', weight: 33 },
    ],
  },
  {
    testKey: 'TRY_HOME_PRIORITY',
    name: 'Try-At-Home Placement Test',
    dimension: 'tryAtHomePlacement',
    variants: [
      { key: 'PRIMARY', weight: 50 },
      { key: 'SECONDARY', weight: 50 },
    ],
  },
  {
    testKey: 'SOCIAL_PROOF_MODE',
    name: 'Social Proof Test',
    dimension: 'socialProof',
    variants: [
      { key: 'NONE', weight: 34 },
      { key: 'GLOBAL', weight: 33 },
      { key: 'LOCAL', weight: 33 },
    ],
  },
  {
    testKey: 'PRICE_CONTEXT_MODE',
    name: 'Price Framing Test',
    dimension: 'priceContext',
    variants: [
      { key: 'PLAIN', weight: 34 },
      { key: 'DELIVERY', weight: 33 },
      { key: 'TRY_CONTEXT', weight: 33 },
    ],
  },
];

function stableInt(seed) {
  const digest = crypto.createHash('sha256').update(seed).digest('hex');
  return parseInt(digest.slice(0, 8), 16);
}

function bucketFromInt(value) {
  const index = value % 3;
  return ['A', 'B', 'C'][index];
}

function pickWeightedVariant(variants, seedInt) {
  const totalWeight = variants.reduce((sum, variant) => sum + Math.max(0, Number(variant.weight) || 0), 0);
  if (totalWeight <= 0) {
    return variants[0]?.key || '';
  }

  const roll = (seedInt % 10000) / 10000;
  let cumulative = 0;
  for (const variant of variants) {
    const weight = Math.max(0, Number(variant.weight) || 0) / totalWeight;
    cumulative += weight;
    if (roll <= cumulative) {
      return String(variant.key || '').trim().toUpperCase();
    }
  }
  return String(variants[variants.length - 1]?.key || '').trim().toUpperCase();
}

async function ensureDefaultTests() {
  await Promise.all(
    DEFAULT_TESTS.map((test) =>
      ABTest.updateOne(
        { testKey: test.testKey },
        {
          $setOnInsert: {
            ...test,
            status: 'ACTIVE',
          },
        },
        { upsert: true },
      ),
    ),
  );
}

async function getActiveTests() {
  await ensureDefaultTests();
  return ABTest.find({ status: 'ACTIVE' })
    .select('testKey dimension variants status')
    .lean();
}

async function assignUserVariants({ userId }) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    return {};
  }

  const activeTests = await getActiveTests();
  const assignments = {};

  for (const test of activeTests) {
    const testKey = String(test.testKey || '').trim().toUpperCase();
    if (!testKey) {
      continue;
    }

    const existing = await UserBucket.findOne({ userId: normalizedUserId, testKey }).lean();
    if (existing) {
      assignments[test.dimension] = existing.variantKey;
      await UserBucket.updateOne(
        { _id: existing._id },
        { $set: { lastSeenAt: new Date() } },
      );
      continue;
    }

    const seedInt = stableInt(`${normalizedUserId}:${testKey}`);
    const bucket = bucketFromInt(seedInt);
    const variantKey = pickWeightedVariant(test.variants || [], seedInt);
    if (!variantKey) {
      continue;
    }

    await UserBucket.create({
      userId: normalizedUserId,
      testKey,
      bucket,
      variantKey,
      assignmentSource: 'deterministic_hash',
    });

    assignments[test.dimension] = variantKey;
  }

  return assignments;
}

module.exports = {
  assignUserVariants,
  ensureDefaultTests,
};
