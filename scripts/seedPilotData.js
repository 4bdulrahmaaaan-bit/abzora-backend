/**
 * seedPilotData.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chennai Pilot Load Simulation Seed Script
 *
 * WARNING: This script writes SYNTHETIC data to a SEPARATE "abzora_seed_test"
 * database, never to the production database. Run ONLY for benchmarking.
 *
 * Usage:
 *   node scripts/seedPilotData.js          (seed only)
 *   node scripts/seedPilotData.js --clean  (drop seed DB first, then re-seed)
 *
 * Targets:
 *   Users           5,000
 *   Orders         20,000
 *   Trials          5,000
 *   Vendors           100
 *   Riders            200
 *   Settlements    10,000
 *   Notifications  50,000
 *   Audit Logs    100,000
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

// ─── Safety guard ─────────────────────────────────────────────────────────────
// Derive seed DB URI from MONGO_URI but override the DB name.
const SEED_DB_NAME = 'abzora_seed_test';
const baseUri = (process.env.MONGO_URI || '').replace(
  /(\/[^/?]+)?(\?|$)/,
  `/${SEED_DB_NAME}$2`,
);
if (!baseUri || !baseUri.includes(SEED_DB_NAME)) {
  console.error('❌  Could not derive seed DB URI from MONGO_URI. Aborting.');
  process.exit(1);
}

// ─── Lightweight inline schemas ────────────────────────────────────────────────
const { Schema, model, Types } = mongoose;

const UserS = new Schema({ email: String, name: String, phone: String, role: { type: String, default: 'customer' }, createdAt: { type: Date, default: Date.now } });
const StoreS = new Schema({ name: String, isActive: { type: Boolean, default: true }, rating: Number, vendorId: String, createdAt: { type: Date, default: Date.now } });
const OrderS = new Schema({ userId: String, storeId: Types.ObjectId, totalAmount: Number, platformCommission: Number, orderStatus: String, paymentStatus: String, createdAt: { type: Date, default: Date.now } });
const TrialS = new Schema({ userId: String, storeId: Types.ObjectId, status: String, scheduledDate: Date, createdAt: { type: Date, default: Date.now } });
const RiderS = new Schema({ name: String, phone: String, isOnline: Boolean, city: String, createdAt: { type: Date, default: Date.now } });
const SettlementS = new Schema({ userId: String, amount: Number, status: String, settlementType: String, createdAt: { type: Date, default: Date.now } });
const NotifS = new Schema({ title: String, body: String, type: String, audienceRole: String, isRead: Boolean, createdAt: { type: Date, default: Date.now } });
const LogS = new Schema({ adminId: String, action: String, target: String, details: Object, timestamp: { type: Date, default: Date.now } });

const UserM = model('SeedUser', UserS, 'users_seed');
const StoreM = model('SeedStore', StoreS, 'stores_seed');
const OrderM = model('SeedOrder', OrderS, 'orders_seed');
const TrialM = model('SeedTrial', TrialS, 'trials_seed');
const RiderM = model('SeedRider', RiderS, 'riders_seed');
const SettlementM = model('SeedSettlement', SettlementS, 'settlements_seed');
const NotifM = model('SeedNotif', NotifS, 'notifications_seed');
const LogM = model('SeedLog', LogS, 'admin_activity_logs_seed');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};
const insertChunked = async (Model, docs, batchSize = 1000) => {
  let inserted = 0;
  for (const batch of chunk(docs, batchSize)) {
    await Model.insertMany(batch, { ordered: false });
    inserted += batch.length;
    process.stdout.write(`\r    ↳ ${inserted}/${docs.length} inserted`);
  }
  console.log();
};

// ─── Seed functions ───────────────────────────────────────────────────────────
async function seedUsers(n = 5000) {
  console.log(`\n📦 Seeding ${n} Users...`);
  const docs = Array.from({ length: n }, (_, i) => ({
    email: `pilot_user_${i}@seed.local`,
    name: `Pilot User ${i}`,
    phone: `+91${String(9000000000 + i)}`,
    role: pick(['customer', 'customer', 'customer', 'vendor', 'rider']),
  }));
  await insertChunked(UserM, docs);
}

async function seedStores(n = 100) {
  console.log(`\n📦 Seeding ${n} Vendors/Stores...`);
  const docs = Array.from({ length: n }, (_, i) => ({
    name: `Seed Store ${i}`,
    isActive: Math.random() > 0.1,
    rating: (Math.random() * 2 + 3).toFixed(1),
    vendorId: new Types.ObjectId().toString(),
  }));
  await insertChunked(StoreM, docs);
  return await StoreM.find({}).select('_id').lean();
}

async function seedRiders(n = 200) {
  console.log(`\n📦 Seeding ${n} Riders...`);
  const cities = ['Chennai', 'Tambaram', 'Velachery', 'OMR', 'T.Nagar'];
  const docs = Array.from({ length: n }, (_, i) => ({
    name: `Seed Rider ${i}`,
    phone: `+91${String(8000000000 + i)}`,
    isOnline: Math.random() > 0.4,
    city: pick(cities),
  }));
  await insertChunked(RiderM, docs);
}

async function seedOrders(storeIds, n = 20000) {
  console.log(`\n📦 Seeding ${n} Orders...`);
  const statuses = ['pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled'];
  const payStatuses = ['paid', 'paid', 'paid', 'pending', 'failed'];
  const now = Date.now();
  const docs = Array.from({ length: n }, (_, i) => ({
    userId: `seed_uid_${i % 5000}`,
    storeId: pick(storeIds)._id,
    totalAmount: rand(299, 4999),
    platformCommission: rand(15, 300),
    orderStatus: pick(statuses),
    paymentStatus: pick(payStatuses),
    createdAt: new Date(now - rand(0, 90 * 24 * 60 * 60 * 1000)),
  }));
  await insertChunked(OrderM, docs);
}

async function seedTrials(storeIds, n = 5000) {
  console.log(`\n📦 Seeding ${n} Trials...`);
  const statuses = ['booked', 'active', 'completed', 'cancelled', 'disputed'];
  const now = Date.now();
  const docs = Array.from({ length: n }, (_, i) => ({
    userId: `seed_uid_${i % 5000}`,
    storeId: pick(storeIds)._id,
    status: pick(statuses),
    scheduledDate: new Date(now - rand(0, 60 * 24 * 60 * 60 * 1000)),
  }));
  await insertChunked(TrialM, docs);
}

async function seedSettlements(n = 10000) {
  console.log(`\n📦 Seeding ${n} Settlements...`);
  const types = ['Vendor', 'Rider'];
  const statuses = ['Pending', 'Processed', 'Failed'];
  const docs = Array.from({ length: n }, (_, i) => ({
    userId: `seed_uid_${i % 5000}`,
    amount: rand(500, 15000),
    status: pick(statuses),
    settlementType: pick(types),
  }));
  await insertChunked(SettlementM, docs);
}

async function seedNotifications(n = 50000) {
  console.log(`\n📦 Seeding ${n} Notifications...`);
  const types = ['order_update', 'trial_update', 'promotion', 'fraud_alert', 'system'];
  const roles = ['customer', 'vendor', 'rider', 'admin'];
  const now = Date.now();
  const docs = Array.from({ length: n }, (_, i) => ({
    title: `Notification ${i}`,
    body: `This is a seed notification body for pilot testing #${i}.`,
    type: pick(types),
    audienceRole: pick(roles),
    isRead: Math.random() > 0.6,
    createdAt: new Date(now - rand(0, 30 * 24 * 60 * 60 * 1000)),
  }));
  await insertChunked(NotifM, docs, 2000);
}

async function seedAuditLogs(n = 100000) {
  console.log(`\n📦 Seeding ${n} Audit Logs...`);
  const actions = ['approve_kyc', 'reject_kyc', 'process_settlement', 'flag_fraud', 'update_settings', 'broadcast_notification', 'trigger_automation'];
  const now = Date.now();
  const docs = Array.from({ length: n }, (_, i) => ({
    adminId: 'seed_admin',
    action: pick(actions),
    target: `seed_target_${i % 10000}`,
    details: { index: i, synthetic: true },
    timestamp: new Date(now - rand(0, 180 * 24 * 60 * 60 * 1000)),
  }));
  await insertChunked(LogM, docs, 5000);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const clean = process.argv.includes('--clean');

  console.log('🚀 Connecting to SEED database:', SEED_DB_NAME);
  await mongoose.connect(baseUri, { serverSelectionTimeoutMS: 15000 });
  console.log('✅  Connected.');

  if (clean) {
    console.log('🧹 Dropping seed collections...');
    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      if (col.name.endsWith('_seed')) {
        await db.collection(col.name).drop().catch(() => {});
        console.log(`   Dropped: ${col.name}`);
      }
    }
  }

  const start = Date.now();

  const storeIds = await seedStores(100);
  await seedUsers(5000);
  await seedRiders(200);
  await seedOrders(storeIds, 20000);
  await seedTrials(storeIds, 5000);
  await seedSettlements(10000);
  await seedNotifications(50000);
  await seedAuditLogs(100000);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✅  Seeding complete in ${elapsed}s`);
  console.log('📝  All data written to DB:', SEED_DB_NAME);
  console.log('⚠️   This data is for benchmarking only. Production DB untouched.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});
