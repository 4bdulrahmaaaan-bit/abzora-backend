const AdminPayout = require('../models/AdminPayout');
const AdminWallet = require('../models/AdminWallet');
const RiderWallet = require('../models/RiderWallet');
const Store = require('../models/Store');
const Transaction = require('../models/Transaction');
const VendorWallet = require('../models/VendorWallet');

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function financeConfig() {
  return {
    adminCommissionPercent: Number(process.env.ADMIN_COMMISSION_PERCENT || 0.12),
    baseDeliveryFee: Number(process.env.BASE_DELIVERY_FEE || 50),
    distanceRate: Number(process.env.DISTANCE_RATE_PER_KM || 5),
    vendorMinWithdrawal: Number(process.env.VENDOR_MIN_WITHDRAWAL || 500),
    riderMinWithdrawal: Number(process.env.RIDER_MIN_WITHDRAWAL || 200),
  };
}

function buildTransactionId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function recordTransaction({
  type,
  userType,
  userId,
  amount,
  status,
  note = '',
  orderId = '',
  payoutId = '',
  storeId = '',
  riderId = '',
  metadata = {},
}) {
  return Transaction.create({
    transactionId: buildTransactionId(type),
    type,
    userType,
    userId,
    amount: roundMoney(amount),
    status,
    note,
    orderId,
    payoutId,
    storeId,
    riderId,
    createdAtIso: new Date().toISOString(),
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]),
    ),
  });
}

function calculateOrderFinancials({
  subtotalAmount,
  taxAmount = 0,
  deliveryFee,
  deliveryDistanceKm = 0,
  commissionPercent,
}) {
  const config = financeConfig();
  const safeSubtotal = roundMoney(subtotalAmount);
  const safeTax = roundMoney(taxAmount);
  const safeDistance = Math.max(0, Number(deliveryDistanceKm || 0));
  const resolvedDeliveryFee =
    deliveryFee == null
      ? roundMoney(config.baseDeliveryFee + safeDistance * config.distanceRate)
      : roundMoney(deliveryFee);
  const resolvedCommissionPercent =
    commissionPercent == null || Number.isNaN(Number(commissionPercent))
      ? config.adminCommissionPercent
      : Number(commissionPercent);
  const platformCommission = roundMoney(safeSubtotal * resolvedCommissionPercent);
  const vendorEarnings = roundMoney(Math.max(0, safeSubtotal - platformCommission));
  const riderEarnings = roundMoney(resolvedDeliveryFee);
  const totalAmount = roundMoney(safeSubtotal + safeTax + resolvedDeliveryFee);

  return {
    productAmount: safeSubtotal,
    subtotalAmount: safeSubtotal,
    taxAmount: safeTax,
    deliveryFee: resolvedDeliveryFee,
    deliveryDistanceKm: safeDistance,
    platformCommission,
    vendorEarnings,
    riderEarnings,
    totalAmount,
  };
}

async function getOrCreateVendorWallet(storeId, ownerId) {
  return VendorWallet.findOneAndUpdate(
    { storeId },
    {
      $setOnInsert: {
        storeId,
        ownerId,
        balance: 0,
        pendingAmount: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        lastSettlementDate: '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function getOrCreateRiderWallet(riderId) {
  return RiderWallet.findOneAndUpdate(
    { riderId },
    {
      $setOnInsert: {
        riderId,
        balance: 0,
        pendingAmount: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        lastSettlementDate: '',
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function getOrCreateAdminWallet() {
  return AdminWallet.findOneAndUpdate(
    { key: 'primary' },
    {
      $setOnInsert: {
        key: 'primary',
        totalCommission: 0,
        totalRevenue: 0,
        payoutsDone: 0,
        vendorSettlementsDone: 0,
        riderSettlementsDone: 0,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

async function settleDeliveredOrder(order) {
  if (!order || order.paymentStatus !== 'paid' || order.orderStatus !== 'delivered') {
    return order;
  }

  const store = await Store.findById(order.storeId);
  if (!store) {
    return order;
  }

  const vendorWallet = await getOrCreateVendorWallet(order.storeId.toString(), store.ownerId);
  const adminWallet = await getOrCreateAdminWallet();

  if (!order.commissionRecorded) {
    adminWallet.totalCommission = roundMoney(adminWallet.totalCommission + Number(order.platformCommission || 0));
    adminWallet.totalRevenue = roundMoney(adminWallet.totalRevenue + Number(order.totalAmount || 0));
    order.commissionRecorded = true;
    await recordTransaction({
      type: 'commission',
      userType: 'admin',
      userId: 'primary',
      amount: Number(order.platformCommission || 0),
      status: 'earned',
      orderId: order._id.toString(),
      storeId: order.storeId.toString(),
      note: 'Commission captured on delivered order',
    });
  }

  if (!order.vendorCredited) {
    vendorWallet.pendingAmount = roundMoney(vendorWallet.pendingAmount + Number(order.vendorEarnings || 0));
    vendorWallet.totalEarnings = roundMoney(vendorWallet.totalEarnings + Number(order.vendorEarnings || 0));
    order.vendorCredited = true;
    order.payoutStatus = 'pending';
    await recordTransaction({
      type: 'order',
      userType: 'vendor',
      userId: store.ownerId,
      amount: Number(order.vendorEarnings || 0),
      status: 'pending',
      orderId: order._id.toString(),
      storeId: order.storeId.toString(),
      note: 'Vendor earnings pending settlement',
    });
  }

  if (order.riderId && !order.riderCredited) {
    const riderWallet = await getOrCreateRiderWallet(order.riderId);
    riderWallet.pendingAmount = roundMoney(riderWallet.pendingAmount + Number(order.riderEarnings || 0));
    riderWallet.totalEarnings = roundMoney(riderWallet.totalEarnings + Number(order.riderEarnings || 0));
    order.riderCredited = true;
    order.riderPayoutStatus = 'pending';
    await riderWallet.save();
    await recordTransaction({
      type: 'order',
      userType: 'rider',
      userId: order.riderId,
      amount: Number(order.riderEarnings || 0),
      status: 'pending',
      orderId: order._id.toString(),
      storeId: order.storeId.toString(),
      riderId: order.riderId,
      note: 'Rider earnings pending settlement',
    });
  }

  await Promise.all([vendorWallet.save(), adminWallet.save()]);
  return order;
}

async function reverseOrderSettlement(order, reason = 'reversed') {
  if (!order || order.financialReversed) {
    return order;
  }

  const store = await Store.findById(order.storeId);
  const adminWallet = await getOrCreateAdminWallet();

  if (order.commissionRecorded) {
    adminWallet.totalCommission = roundMoney(
      Math.max(0, adminWallet.totalCommission - Number(order.platformCommission || 0)),
    );
    adminWallet.totalRevenue = roundMoney(
      Math.max(0, adminWallet.totalRevenue - Number(order.totalAmount || 0)),
    );
    await recordTransaction({
      type: 'commission',
      userType: 'admin',
      userId: 'primary',
      amount: -Math.abs(Number(order.platformCommission || 0)),
      status: 'reversed',
      orderId: order._id.toString(),
      storeId: order.storeId.toString(),
      note: reason,
    });
  }

  if (store && order.vendorCredited) {
    const vendorWallet = await getOrCreateVendorWallet(order.storeId.toString(), store.ownerId);
    const vendorAmount = Number(order.vendorEarnings || 0);
    const pendingDeduction = Math.min(vendorWallet.pendingAmount, vendorAmount);
    vendorWallet.pendingAmount = roundMoney(vendorWallet.pendingAmount - pendingDeduction);
    const remainder = roundMoney(vendorAmount - pendingDeduction);
    if (remainder > 0) {
      vendorWallet.balance = roundMoney(Math.max(0, vendorWallet.balance - remainder));
      store.walletBalance = roundMoney(Math.max(0, Number(store.walletBalance || 0) - remainder));
      await store.save();
    }
    await vendorWallet.save();
    await recordTransaction({
      type: 'order',
      userType: 'vendor',
      userId: store.ownerId,
      amount: -Math.abs(vendorAmount),
      status: 'reversed',
      orderId: order._id.toString(),
      storeId: order.storeId.toString(),
      note: reason,
    });
  }

  if (order.riderId && order.riderCredited) {
    const riderWallet = await getOrCreateRiderWallet(order.riderId);
    const riderAmount = Number(order.riderEarnings || 0);
    const pendingDeduction = Math.min(riderWallet.pendingAmount, riderAmount);
    riderWallet.pendingAmount = roundMoney(riderWallet.pendingAmount - pendingDeduction);
    const remainder = roundMoney(riderAmount - pendingDeduction);
    if (remainder > 0) {
      riderWallet.balance = roundMoney(Math.max(0, riderWallet.balance - remainder));
    }
    await riderWallet.save();
    await recordTransaction({
      type: 'order',
      userType: 'rider',
      userId: order.riderId,
      amount: -Math.abs(riderAmount),
      status: 'reversed',
      orderId: order._id.toString(),
      storeId: order.storeId.toString(),
      riderId: order.riderId,
      note: reason,
    });
  }

  order.financialReversed = true;
  order.payoutStatus = 'reversed';
  order.riderPayoutStatus = 'reversed';
  await adminWallet.save();
  return order;
}

async function settleVendorWallet({ storeId, processedBy, periodLabel = 'Auto settlement', orders = [] }) {
  const wallet = await VendorWallet.findOne({ storeId });
  if (!wallet || wallet.pendingAmount <= 0) {
    return null;
  }

  const orderIds = orders.map((order) => order._id.toString());
  const payoutId = `vendor-payout-${Date.now()}`;
  const amount = roundMoney(wallet.pendingAmount);
  wallet.balance = roundMoney(wallet.balance + wallet.pendingAmount);
  wallet.pendingAmount = 0;
  wallet.lastSettlementDate = new Date().toISOString();
  wallet.totalWithdrawn = roundMoney(wallet.totalWithdrawn);
  await wallet.save();

  const store = await Store.findById(storeId);
  if (store) {
    store.walletBalance = roundMoney(wallet.balance);
    await store.save();
  }

  const adminWallet = await getOrCreateAdminWallet();
  adminWallet.payoutsDone = roundMoney(adminWallet.payoutsDone + amount);
  adminWallet.vendorSettlementsDone = roundMoney(adminWallet.vendorSettlementsDone + amount);
  await adminWallet.save();

  const payout = await AdminPayout.create({
    payoutId,
    storeId,
    processedBy,
    amount,
    periodLabel,
    createdAtIso: new Date().toISOString(),
    orderIds,
    status: 'Processed',
  });

  if (store) {
    await recordTransaction({
      type: 'payout',
      userType: 'vendor',
      userId: wallet.ownerId,
      amount,
      status: 'processed',
      payoutId,
      storeId,
      note: periodLabel,
    });
  }

  return payout;
}

async function settleRiderWallet({ riderId, processedBy, periodLabel = 'Auto settlement', orders = [] }) {
  const wallet = await RiderWallet.findOne({ riderId });
  if (!wallet || wallet.pendingAmount <= 0) {
    return null;
  }

  const payoutId = `rider-payout-${Date.now()}`;
  const amount = roundMoney(wallet.pendingAmount);
  wallet.balance = roundMoney(wallet.balance + wallet.pendingAmount);
  wallet.pendingAmount = 0;
  wallet.lastSettlementDate = new Date().toISOString();
  await wallet.save();

  const adminWallet = await getOrCreateAdminWallet();
  adminWallet.payoutsDone = roundMoney(adminWallet.payoutsDone + amount);
  adminWallet.riderSettlementsDone = roundMoney(adminWallet.riderSettlementsDone + amount);
  await adminWallet.save();

  await recordTransaction({
    type: 'payout',
    userType: 'rider',
    userId: riderId,
    amount,
    status: 'processed',
    payoutId,
    riderId,
    note: periodLabel,
    metadata: {
      processedBy,
      orderCount: orders.length,
    },
  });

  return {
    payoutId,
    amount,
    riderId,
    periodLabel,
    orderIds: orders.map((order) => order._id.toString()),
    status: 'Processed',
    createdAtIso: new Date().toISOString(),
  };
}

async function createWithdrawalRequest({ walletType, wallet, userId, amount, note }) {
  const config = financeConfig();
  const safeAmount = roundMoney(amount);
  const minimum = walletType === 'vendor' ? config.vendorMinWithdrawal : config.riderMinWithdrawal;
  if (safeAmount < minimum) {
    throw new Error(`Minimum ${walletType} withdrawal is Rs ${minimum}.`);
  }
  if (safeAmount > Number(wallet.balance || 0)) {
    throw new Error('Insufficient balance for withdrawal.');
  }
  wallet.balance = roundMoney(wallet.balance - safeAmount);
  wallet.totalWithdrawn = roundMoney(Number(wallet.totalWithdrawn || 0) + safeAmount);
  await wallet.save();

  await recordTransaction({
    type: 'payout',
    userType: walletType,
    userId,
    amount: safeAmount,
    status: 'requested',
    storeId: walletType === 'vendor' ? wallet.storeId : '',
    riderId: walletType === 'rider' ? wallet.riderId : '',
    note,
  });

  return wallet;
}

module.exports = {
  calculateOrderFinancials,
  createWithdrawalRequest,
  financeConfig,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  recordTransaction,
  reverseOrderSettlement,
  roundMoney,
  settleDeliveredOrder,
  settleRiderWallet,
  settleVendorWallet,
};
