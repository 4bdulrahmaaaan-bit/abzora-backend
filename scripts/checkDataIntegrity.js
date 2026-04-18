require('dotenv').config();
const mongoose = require('mongoose');

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });
  const db = mongoose.connection.db;

  const [users, stores, orders, vendorWallets, fraudAlerts] = await Promise.all([
    db.collection('users').find({}, { projection: { uid: 1, firebaseUid: 1, role: 1, storeId: 1 } }).toArray(),
    db.collection('stores').find({}, { projection: { ownerId: 1, name: 1, isActive: 1 } }).toArray(),
    db.collection('orders').find({}, { projection: { userId: 1, storeId: 1, riderId: 1, paymentStatus: 1, orderStatus: 1, deliveryStatus: 1, isSuspicious: 1, fraudStatus: 1, lastSettlementError: 1 } }).toArray(),
    db.collection('vendorwallets').find({}, { projection: { ownerId: 1, storeId: 1, balance: 1, pendingAmount: 1, totalEarnings: 1 } }).toArray(),
    db.collection('fraudalerts').find({}, { projection: { userId: 1, type: 1, severity: 1, status: 1, reasons: 1, createdAt: 1 } }).toArray(),
  ]);

  const userIds = new Set(users.flatMap((user) => [user.uid, user.firebaseUid]).filter(Boolean));
  const storeIds = new Set(stores.map((store) => String(store._id)));

  const orphanOrders = orders
    .map((order) => {
      const issues = [];
      if (!userIds.has(order.userId)) issues.push('missing_user');
      if (!storeIds.has(String(order.storeId))) issues.push('missing_store');
      if (order.riderId && !userIds.has(order.riderId)) issues.push('missing_rider');
      if (!issues.length) return null;

      const alreadyArchived =
        order.orderStatus === 'cancelled' &&
        order.deliveryStatus === 'Cancelled' &&
        order.isSuspicious === true &&
        order.fraudStatus === 'review' &&
        String(order.lastSettlementError || '').includes('orphaned-record maintenance script');

      return alreadyArchived ? null : { orderId: String(order._id), issues };
    })
    .filter(Boolean);

  const orphanStores = stores
    .map((store) => {
      const missingOwner = store.ownerId && !userIds.has(store.ownerId);
      const alreadyArchived = store.isActive === false;
      return missingOwner && !alreadyArchived
        ? { storeId: String(store._id), ownerId: store.ownerId, name: store.name || '' }
        : null;
    })
    .filter(Boolean);

  const orphanVendorWallets = vendorWallets
    .map((wallet) => {
      const issues = [];
      if (wallet.ownerId && !userIds.has(wallet.ownerId)) issues.push('missing_owner');
      if (!storeIds.has(String(wallet.storeId))) issues.push('missing_store');
      return issues.length ? { walletId: String(wallet._id), issues } : null;
    })
    .filter(Boolean);

  const duplicateFraudKeys = new Map();
  for (const alert of fraudAlerts) {
    const reasons = Array.isArray(alert.reasons) ? [...alert.reasons].sort() : [];
    const key = JSON.stringify({
      userId: alert.userId || '',
      type: alert.type || '',
      severity: alert.severity || '',
      status: alert.status || '',
      reasons,
    });
    duplicateFraudKeys.set(key, (duplicateFraudKeys.get(key) || 0) + 1);
  }

  const noisyFraudPatterns = [...duplicateFraudKeys.entries()]
    .filter(([, count]) => count >= 5)
    .map(([key, count]) => ({ pattern: JSON.parse(key), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const report = {
    counts: {
      users: users.length,
      stores: stores.length,
      orders: orders.length,
      vendorWallets: vendorWallets.length,
      fraudAlerts: fraudAlerts.length,
    },
    orphanOrders,
    orphanStores,
    orphanVendorWallets,
    noisyFraudPatterns,
  };

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
  });
