require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Store = require('../models/Store');
const User = require('../models/User');

function toUserIds(users = []) {
  return new Set(
    users.flatMap((user) => [user.uid, user.firebaseUid]).filter(Boolean),
  );
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const applyChanges = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const [users, stores, orders] = await Promise.all([
    User.find({}, { uid: 1, firebaseUid: 1 }).lean(),
    Store.find({}, { ownerId: 1, name: 1, isActive: 1 }).lean(),
    Order.find({}, { userId: 1, storeId: 1, riderId: 1, orderStatus: 1, paymentStatus: 1 }).lean(),
  ]);

  const userIds = toUserIds(users);
  const storeIds = new Set(stores.map((store) => String(store._id)));

  const orphanOrders = orders.filter((order) => (
    !userIds.has(order.userId) ||
    !storeIds.has(String(order.storeId)) ||
    (order.riderId && !userIds.has(order.riderId))
  ));

  const orphanStores = stores.filter((store) => store.ownerId && !userIds.has(store.ownerId));

  const report = {
    mode: applyChanges ? 'apply' : 'dry-run',
    orphanOrders: orphanOrders.map((order) => ({
      orderId: String(order._id),
      userId: order.userId || '',
      storeId: String(order.storeId || ''),
      riderId: order.riderId || '',
      orderStatus: order.orderStatus || '',
      paymentStatus: order.paymentStatus || '',
    })),
    orphanStores: orphanStores.map((store) => ({
      storeId: String(store._id),
      name: store.name || '',
      ownerId: store.ownerId || '',
      isActive: store.isActive !== false,
    })),
  };

  if (applyChanges) {
    const nowIso = new Date().toISOString();

    let updatedOrders = { modifiedCount: 0 };
    if (orphanOrders.length > 0) {
      updatedOrders = await Order.updateMany(
        { _id: { $in: orphanOrders.map((order) => order._id) } },
        {
          $set: {
            orderStatus: 'cancelled',
            deliveryStatus: 'Cancelled',
            fraudStatus: 'review',
            isSuspicious: true,
            lastSettlementError: 'Order archived by orphaned-record maintenance script.',
          },
        },
      );
    }

    let updatedStores = { modifiedCount: 0 };
    if (orphanStores.length > 0) {
      updatedStores = await Store.updateMany(
        { _id: { $in: orphanStores.map((store) => store._id) } },
        {
          $set: {
            isActive: false,
            description: `Archived on ${nowIso}: owner reference missing.`,
          },
        },
      );
    }

    report.modifiedOrders = updatedOrders.modifiedCount || 0;
    report.modifiedStores = updatedStores.modifiedCount || 0;
    report.updatedAt = nowIso;
  }

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
