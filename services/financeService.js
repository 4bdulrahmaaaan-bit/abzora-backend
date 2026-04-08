const mongoose = require('mongoose');

const AdminPayout = require('../models/AdminPayout');
const AdminWallet = require('../models/AdminWallet');
const FinanceAuditLog = require('../models/FinanceAuditLog');
const Order = require('../models/Order');
const RiderWallet = require('../models/RiderWallet');
const Store = require('../models/Store');
const Transaction = require('../models/Transaction');
const VendorWallet = require('../models/VendorWallet');
const WithdrawalRequest = require('../models/WithdrawalRequest');

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function nowIso() {
  return new Date().toISOString();
}

function financeConfig() {
  return {
    adminCommissionPercent: Number(process.env.ADMIN_COMMISSION_PERCENT || 0.12),
    baseDeliveryFee: Number(process.env.BASE_DELIVERY_FEE || 50),
    distanceRate: Number(process.env.DISTANCE_RATE_PER_KM || 5),
    vendorMinWithdrawal: Number(process.env.VENDOR_MIN_WITHDRAWAL || 100),
    riderMinWithdrawal: Number(process.env.RIDER_MIN_WITHDRAWAL || 100),
    vendorSettlementCron: process.env.VENDOR_SETTLEMENT_CRON || '15 2 * * *',
    riderSettlementCron: process.env.RIDER_SETTLEMENT_CRON || '30 2 * * *',
  };
}

function buildId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runWithOptionalSession(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (error) {
    const message = String(error?.message || '');
    const unsupportedTransaction =
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set') ||
      message.includes('Transaction support');
    if (!unsupportedTransaction) {
      throw error;
    }
    return work(null);
  } finally {
    await session.endSession();
  }
}

function withSession(options = {}, session) {
  return session ? { ...options, session } : options;
}

async function recordTransaction(
  {
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
  },
  session = null,
) {
  const payload = {
    transactionId: buildId(type),
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
    createdAtIso: nowIso(),
    metadata: Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]),
    ),
  };
  const [created] = await Transaction.create([payload], withSession({}, session));
  return created;
}

async function recordFinanceAudit(
  {
    action,
    actorId = '',
    actorRole = '',
    status = 'success',
    walletType = '',
    storeId = '',
    riderId = '',
    orderIds = [],
    withdrawalRequestId = '',
    payoutId = '',
    amount = 0,
    message = '',
    metadata = {},
  },
  session = null,
) {
  const [created] = await FinanceAuditLog.create(
    [
      {
        action,
        actorId,
        actorRole,
        status,
        walletType,
        storeId,
        riderId,
        orderIds,
        withdrawalRequestId,
        payoutId,
        amount: roundMoney(amount),
        message,
        createdAtIso: nowIso(),
        metadata: Object.fromEntries(
          Object.entries(metadata).map(([key, value]) => [key, String(value ?? '')]),
        ),
      },
    ],
    withSession({}, session),
  );
  return created;
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

async function getOrCreateVendorWallet(storeId, ownerId, session = null) {
  return VendorWallet.findOneAndUpdate(
    { storeId },
    {
      $setOnInsert: {
        storeId,
        ownerId,
        balance: 0,
        pendingAmount: 0,
        reservedAmount: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        lastSettlementDate: '',
      },
    },
    withSession({ upsert: true, new: true, setDefaultsOnInsert: true }, session),
  );
}

async function getOrCreateRiderWallet(riderId, session = null) {
  return RiderWallet.findOneAndUpdate(
    { riderId },
    {
      $setOnInsert: {
        riderId,
        balance: 0,
        pendingAmount: 0,
        reservedAmount: 0,
        totalEarnings: 0,
        totalWithdrawn: 0,
        lastSettlementDate: '',
      },
    },
    withSession({ upsert: true, new: true, setDefaultsOnInsert: true }, session),
  );
}

async function getOrCreateAdminWallet(session = null) {
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
        failedSettlements: 0,
      },
    },
    withSession({ upsert: true, new: true, setDefaultsOnInsert: true }, session),
  );
}

function normalizedOrderIds(orders = []) {
  return orders.map((item) => item._id?.toString() || item.id?.toString() || '').filter(Boolean);
}

async function settleDeliveredOrder(order, options = {}) {
  if (!order?._id) {
    return order;
  }

  return runWithOptionalSession(async (session) => {
    const actorId = options.triggeredBy || 'system';
    const actorRole = options.actorRole || (actorId === 'system' ? 'system' : 'admin');
    const freshOrder = await Order.findById(order._id).session(session);
    if (!freshOrder || freshOrder.paymentStatus !== 'paid' || freshOrder.orderStatus !== 'delivered') {
      return freshOrder || order;
    }

    const store = await Store.findById(freshOrder.storeId).session(session);
    if (!store) {
      return freshOrder;
    }

    const vendorWallet = await getOrCreateVendorWallet(
      freshOrder.storeId.toString(),
      store.ownerId,
      session,
    );
    const adminWallet = await getOrCreateAdminWallet(session);
    const currentIso = nowIso();

    if (!freshOrder.commissionRecorded) {
      adminWallet.totalCommission = roundMoney(
        Number(adminWallet.totalCommission || 0) + Number(freshOrder.platformCommission || 0),
      );
      adminWallet.totalRevenue = roundMoney(
        Number(adminWallet.totalRevenue || 0) + Number(freshOrder.totalAmount || 0),
      );
      freshOrder.commissionRecorded = true;
      await recordTransaction(
        {
          type: 'commission',
          userType: 'admin',
          userId: 'primary',
          amount: Number(freshOrder.platformCommission || 0),
          status: 'earned',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          note: 'Commission captured into escrow',
        },
        session,
      );
    }

    if (!freshOrder.vendorCredited) {
      vendorWallet.pendingAmount = roundMoney(
        Number(vendorWallet.pendingAmount || 0) + Number(freshOrder.vendorEarnings || 0),
      );
      vendorWallet.totalEarnings = roundMoney(
        Number(vendorWallet.totalEarnings || 0) + Number(freshOrder.vendorEarnings || 0),
      );
      freshOrder.vendorCredited = true;
      freshOrder.payoutStatus = 'pending';
      await recordTransaction(
        {
          type: 'order',
          userType: 'vendor',
          userId: store.ownerId,
          amount: Number(freshOrder.vendorEarnings || 0),
          status: 'pending',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          note: 'Vendor earnings moved to escrow pending settlement',
        },
        session,
      );
    }

    if (freshOrder.riderId && !freshOrder.riderCredited) {
      const riderWallet = await getOrCreateRiderWallet(freshOrder.riderId, session);
      riderWallet.pendingAmount = roundMoney(
        Number(riderWallet.pendingAmount || 0) + Number(freshOrder.riderEarnings || 0),
      );
      riderWallet.totalEarnings = roundMoney(
        Number(riderWallet.totalEarnings || 0) + Number(freshOrder.riderEarnings || 0),
      );
      freshOrder.riderCredited = true;
      freshOrder.riderPayoutStatus = 'pending';
      await riderWallet.save(withSession({}, session));
      await recordTransaction(
        {
          type: 'order',
          userType: 'rider',
          userId: freshOrder.riderId,
          amount: Number(freshOrder.riderEarnings || 0),
          status: 'pending',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          riderId: freshOrder.riderId,
          note: 'Rider earnings moved to escrow pending settlement',
        },
        session,
      );
    }

    freshOrder.escrowStatus = 'held';
    freshOrder.escrowUpdatedAt = currentIso;
    freshOrder.lastSettlementError = '';

    await Promise.all([
      vendorWallet.save(withSession({}, session)),
      adminWallet.save(withSession({}, session)),
      freshOrder.save(withSession({}, session)),
      recordFinanceAudit(
        {
          action: 'escrow_hold',
          actorId,
          actorRole,
          status: 'success',
          walletType: 'admin',
          storeId: freshOrder.storeId.toString(),
          riderId: freshOrder.riderId || '',
          orderIds: [freshOrder._id.toString()],
          amount: Number(freshOrder.totalAmount || 0),
          message: 'Delivered order earnings moved into escrow.',
        },
        session,
      ),
    ]);

    return freshOrder;
  });
}

async function reverseOrderSettlement(order, reason = 'reversed', options = {}) {
  if (!order?._id) {
    return order;
  }

  return runWithOptionalSession(async (session) => {
    const actorId = options.triggeredBy || 'system';
    const actorRole = options.actorRole || (actorId === 'system' ? 'system' : 'admin');
    const freshOrder = await Order.findById(order._id).session(session);
    if (!freshOrder || freshOrder.financialReversed) {
      return freshOrder || order;
    }

    const store = await Store.findById(freshOrder.storeId).session(session);
    const adminWallet = await getOrCreateAdminWallet(session);

    if (freshOrder.commissionRecorded) {
      adminWallet.totalCommission = roundMoney(
        Math.max(0, Number(adminWallet.totalCommission || 0) - Number(freshOrder.platformCommission || 0)),
      );
      adminWallet.totalRevenue = roundMoney(
        Math.max(0, Number(adminWallet.totalRevenue || 0) - Number(freshOrder.totalAmount || 0)),
      );
      await recordTransaction(
        {
          type: 'commission',
          userType: 'admin',
          userId: 'primary',
          amount: -Math.abs(Number(freshOrder.platformCommission || 0)),
          status: 'reversed',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          note: reason,
        },
        session,
      );
    }

    if (store && freshOrder.vendorCredited) {
      const vendorWallet = await getOrCreateVendorWallet(
        freshOrder.storeId.toString(),
        store.ownerId,
        session,
      );
      const vendorAmount = Number(freshOrder.vendorEarnings || 0);
      const pendingDeduction = Math.min(Number(vendorWallet.pendingAmount || 0), vendorAmount);
      vendorWallet.pendingAmount = roundMoney(Number(vendorWallet.pendingAmount || 0) - pendingDeduction);
      const remainder = roundMoney(vendorAmount - pendingDeduction);
      if (remainder > 0) {
        vendorWallet.balance = roundMoney(Math.max(0, Number(vendorWallet.balance || 0) - remainder));
      }
      store.walletBalance = roundMoney(Math.max(0, Number(vendorWallet.balance || 0)));
      await Promise.all([
        vendorWallet.save(withSession({}, session)),
        store.save(withSession({}, session)),
      ]);
      await recordTransaction(
        {
          type: 'order',
          userType: 'vendor',
          userId: store.ownerId,
          amount: -Math.abs(vendorAmount),
          status: 'reversed',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          note: reason,
        },
        session,
      );
    }

    if (freshOrder.riderId && freshOrder.riderCredited) {
      const riderWallet = await getOrCreateRiderWallet(freshOrder.riderId, session);
      const riderAmount = Number(freshOrder.riderEarnings || 0);
      const pendingDeduction = Math.min(Number(riderWallet.pendingAmount || 0), riderAmount);
      riderWallet.pendingAmount = roundMoney(Number(riderWallet.pendingAmount || 0) - pendingDeduction);
      const remainder = roundMoney(riderAmount - pendingDeduction);
      if (remainder > 0) {
        riderWallet.balance = roundMoney(Math.max(0, Number(riderWallet.balance || 0) - remainder));
      }
      await riderWallet.save(withSession({}, session));
      await recordTransaction(
        {
          type: 'order',
          userType: 'rider',
          userId: freshOrder.riderId,
          amount: -Math.abs(riderAmount),
          status: 'reversed',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          riderId: freshOrder.riderId,
          note: reason,
        },
        session,
      );
    }

    freshOrder.financialReversed = true;
    freshOrder.payoutStatus = 'reversed';
    freshOrder.riderPayoutStatus = 'reversed';
    freshOrder.escrowStatus = 'refunded';
    freshOrder.escrowUpdatedAt = nowIso();
    freshOrder.lastSettlementError = '';

    await Promise.all([
      adminWallet.save(withSession({}, session)),
      freshOrder.save(withSession({}, session)),
      recordFinanceAudit(
        {
          action: 'escrow_reverse',
          actorId,
          actorRole,
          status: 'success',
          walletType: 'admin',
          storeId: freshOrder.storeId.toString(),
          riderId: freshOrder.riderId || '',
          orderIds: [freshOrder._id.toString()],
          amount: Number(freshOrder.totalAmount || 0),
          message: reason,
        },
        session,
      ),
    ]);

    return freshOrder;
  });
}

async function settleVendorWallet({
  storeId,
  processedBy,
  periodLabel = 'Auto settlement',
  orders = [],
  actorRole = 'admin',
}) {
  return runWithOptionalSession(async (session) => {
    const wallet = await VendorWallet.findOne({ storeId }).session(session);
    if (!wallet || Number(wallet.pendingAmount || 0) <= 0) {
      return null;
    }

    const settlementOrders = orders.length
      ? orders
      : await Order.find({
          storeId,
          orderStatus: 'delivered',
          paymentStatus: 'paid',
          payoutStatus: 'pending',
        }).session(session);
    if (settlementOrders.length === 0) {
      return null;
    }

    const orderIds = normalizedOrderIds(settlementOrders);
    const payoutId = buildId('vendor-payout');
    const amount = roundMoney(wallet.pendingAmount);
    const settlementIso = nowIso();

    wallet.balance = roundMoney(Number(wallet.balance || 0) + Number(wallet.pendingAmount || 0));
    wallet.pendingAmount = 0;
    wallet.lastSettlementDate = settlementIso;
    await wallet.save(withSession({}, session));

    const store = await Store.findById(storeId).session(session);
    if (store) {
      store.walletBalance = roundMoney(wallet.balance);
      await store.save(withSession({}, session));
    }

    const adminWallet = await getOrCreateAdminWallet(session);
    adminWallet.payoutsDone = roundMoney(Number(adminWallet.payoutsDone || 0) + amount);
    adminWallet.vendorSettlementsDone = roundMoney(
      Number(adminWallet.vendorSettlementsDone || 0) + amount,
    );
    await adminWallet.save(withSession({}, session));

    const [payout] = await AdminPayout.create(
      [
        {
          payoutId,
          storeId,
          processedBy,
          amount,
          periodLabel,
          createdAtIso: settlementIso,
          orderIds,
          status: 'Processed',
        },
      ],
      withSession({}, session),
    );

    await Order.updateMany(
      { _id: { $in: settlementOrders.map((item) => item._id) } },
      {
        $set: {
          payoutStatus: 'processed',
          payoutProcessed: true,
          payoutId,
          escrowStatus: 'released',
          escrowReleasedAt: settlementIso,
          escrowUpdatedAt: settlementIso,
          lastSettlementError: '',
        },
      },
      withSession({}, session),
    );

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: 'vendor',
          userId: wallet.ownerId,
          amount,
          status: 'processed',
          payoutId,
          storeId,
          note: periodLabel,
          metadata: { processedBy, orderCount: orderIds.length },
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'vendor_settlement',
          actorId: processedBy,
          actorRole,
          status: 'success',
          walletType: 'vendor',
          storeId,
          orderIds,
          payoutId,
          amount,
          message: periodLabel,
        },
        session,
      ),
    ]);

    return payout;
  });
}

async function settleRiderWallet({
  riderId,
  processedBy,
  periodLabel = 'Auto settlement',
  orders = [],
  actorRole = 'admin',
}) {
  return runWithOptionalSession(async (session) => {
    const wallet = await RiderWallet.findOne({ riderId }).session(session);
    if (!wallet || Number(wallet.pendingAmount || 0) <= 0) {
      return null;
    }

    const settlementOrders = orders.length
      ? orders
      : await Order.find({
          riderId,
          orderStatus: 'delivered',
          paymentStatus: 'paid',
          riderPayoutStatus: 'pending',
        }).session(session);
    if (settlementOrders.length === 0) {
      return null;
    }

    const orderIds = normalizedOrderIds(settlementOrders);
    const payoutId = buildId('rider-payout');
    const amount = roundMoney(wallet.pendingAmount);
    const settlementIso = nowIso();

    wallet.balance = roundMoney(Number(wallet.balance || 0) + Number(wallet.pendingAmount || 0));
    wallet.pendingAmount = 0;
    wallet.lastSettlementDate = settlementIso;
    await wallet.save(withSession({}, session));

    const adminWallet = await getOrCreateAdminWallet(session);
    adminWallet.payoutsDone = roundMoney(Number(adminWallet.payoutsDone || 0) + amount);
    adminWallet.riderSettlementsDone = roundMoney(
      Number(adminWallet.riderSettlementsDone || 0) + amount,
    );
    await adminWallet.save(withSession({}, session));

    await Order.updateMany(
      { _id: { $in: settlementOrders.map((item) => item._id) } },
      {
        $set: {
          riderPayoutStatus: 'processed',
          riderPayoutId: payoutId,
          escrowStatus: 'released',
          escrowReleasedAt: settlementIso,
          escrowUpdatedAt: settlementIso,
          lastSettlementError: '',
        },
      },
      withSession({}, session),
    );

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: 'rider',
          userId: riderId,
          amount,
          status: 'processed',
          payoutId,
          riderId,
          note: periodLabel,
          metadata: { processedBy, orderCount: orderIds.length },
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'rider_settlement',
          actorId: processedBy,
          actorRole,
          status: 'success',
          walletType: 'rider',
          riderId,
          orderIds,
          payoutId,
          amount,
          message: periodLabel,
        },
        session,
      ),
    ]);

    return {
      payoutId,
      amount,
      riderId,
      periodLabel,
      orderIds,
      status: 'Processed',
      createdAtIso: settlementIso,
    };
  });
}

async function createWithdrawalRequest({ walletType, wallet, userId, amount, note }) {
  const config = financeConfig();
  const safeAmount = roundMoney(amount);
  const minimum = walletType === 'vendor' ? config.vendorMinWithdrawal : config.riderMinWithdrawal;
  if (safeAmount < minimum) {
    throw new Error(`Minimum ${walletType} withdrawal is Rs ${minimum}.`);
  }

  return runWithOptionalSession(async (session) => {
    const freshWallet = walletType === 'vendor'
      ? await VendorWallet.findById(wallet._id).session(session)
      : await RiderWallet.findById(wallet._id).session(session);
    if (!freshWallet) {
      throw new Error('Wallet not found for withdrawal.');
    }
    if (safeAmount > Number(freshWallet.balance || 0)) {
      throw new Error('Insufficient balance for withdrawal.');
    }

    freshWallet.balance = roundMoney(Number(freshWallet.balance || 0) - safeAmount);
    freshWallet.reservedAmount = roundMoney(Number(freshWallet.reservedAmount || 0) + safeAmount);
    await freshWallet.save(withSession({}, session));

    if (walletType === 'vendor' && freshWallet.storeId) {
      await Store.findByIdAndUpdate(
        freshWallet.storeId,
        { $set: { walletBalance: freshWallet.balance } },
        withSession({}, session),
      );
    }

    const [request] = await WithdrawalRequest.create(
      [
        {
          requestId: buildId(`${walletType}-wd`),
          walletType,
          status: 'pending',
          userId,
          storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
          riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
          amount: safeAmount,
          note,
          requestedAt: nowIso(),
          metadata: { threshold: minimum },
        },
      ],
      withSession({}, session),
    );

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: walletType,
          userId,
          amount: safeAmount,
          status: 'requested',
          payoutId: request.requestId,
          storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
          riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
          note,
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_requested',
          actorId: userId,
          actorRole: walletType,
          status: 'requested',
          walletType,
          storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
          riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
          withdrawalRequestId: request.requestId,
          amount: safeAmount,
          message: note,
        },
        session,
      ),
    ]);

    return {
      wallet: freshWallet,
      request,
    };
  });
}

async function approveWithdrawalRequest({ requestId, processedBy, actorRole = 'admin' }) {
  return runWithOptionalSession(async (session) => {
    const request = await WithdrawalRequest.findOne({ requestId }).session(session);
    if (!request) {
      throw new Error('Withdrawal request not found.');
    }
    if (request.status !== 'pending') {
      throw new Error('This withdrawal request has already been processed.');
    }

    const wallet = request.walletType === 'vendor'
      ? await VendorWallet.findOne({ storeId: request.storeId }).session(session)
      : await RiderWallet.findOne({ riderId: request.riderId }).session(session);
    if (!wallet) {
      throw new Error('Linked wallet not found.');
    }
    if (Number(wallet.reservedAmount || 0) < Number(request.amount || 0)) {
      throw new Error('Reserved withdrawal balance is inconsistent.');
    }

    wallet.reservedAmount = roundMoney(
      Number(wallet.reservedAmount || 0) - Number(request.amount || 0),
    );
    wallet.totalWithdrawn = roundMoney(
      Number(wallet.totalWithdrawn || 0) + Number(request.amount || 0),
    );
    await wallet.save(withSession({}, session));

    if (request.walletType === 'vendor' && request.storeId) {
      await Store.findByIdAndUpdate(
        request.storeId,
        { $set: { walletBalance: wallet.balance } },
        withSession({}, session),
      );
    }

    request.status = 'approved';
    request.processedAt = nowIso();
    request.processedBy = processedBy;
    await request.save(withSession({}, session));

    const adminWallet = await getOrCreateAdminWallet(session);
    adminWallet.payoutsDone = roundMoney(
      Number(adminWallet.payoutsDone || 0) + Number(request.amount || 0),
    );
    await adminWallet.save(withSession({}, session));

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: request.walletType,
          userId: request.userId,
          amount: Number(request.amount || 0),
          status: 'approved',
          payoutId: request.requestId,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          note: 'Withdrawal approved by admin',
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_approved',
          actorId: processedBy,
          actorRole,
          status: 'approved',
          walletType: request.walletType,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          withdrawalRequestId: request.requestId,
          amount: Number(request.amount || 0),
          message: 'Withdrawal approved.',
        },
        session,
      ),
    ]);

    return request;
  });
}

async function rejectWithdrawalRequest({
  requestId,
  processedBy,
  reason,
  actorRole = 'admin',
}) {
  return runWithOptionalSession(async (session) => {
    const request = await WithdrawalRequest.findOne({ requestId }).session(session);
    if (!request) {
      throw new Error('Withdrawal request not found.');
    }
    if (request.status !== 'pending') {
      throw new Error('This withdrawal request has already been processed.');
    }

    const wallet = request.walletType === 'vendor'
      ? await VendorWallet.findOne({ storeId: request.storeId }).session(session)
      : await RiderWallet.findOne({ riderId: request.riderId }).session(session);
    if (!wallet) {
      throw new Error('Linked wallet not found.');
    }

    wallet.reservedAmount = roundMoney(
      Math.max(0, Number(wallet.reservedAmount || 0) - Number(request.amount || 0)),
    );
    wallet.balance = roundMoney(Number(wallet.balance || 0) + Number(request.amount || 0));
    await wallet.save(withSession({}, session));

    if (request.walletType === 'vendor' && request.storeId) {
      await Store.findByIdAndUpdate(
        request.storeId,
        { $set: { walletBalance: wallet.balance } },
        withSession({}, session),
      );
    }

    request.status = 'rejected';
    request.processedAt = nowIso();
    request.processedBy = processedBy;
    request.rejectionReason = reason;
    await request.save(withSession({}, session));

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: request.walletType,
          userId: request.userId,
          amount: -Math.abs(Number(request.amount || 0)),
          status: 'rejected',
          payoutId: request.requestId,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          note: reason || 'Withdrawal rejected',
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_rejected',
          actorId: processedBy,
          actorRole,
          status: 'rejected',
          walletType: request.walletType,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          withdrawalRequestId: request.requestId,
          amount: Number(request.amount || 0),
          message: reason || 'Withdrawal rejected.',
        },
        session,
      ),
    ]);

    return request;
  });
}

async function listWithdrawalRequests(filter = {}, session = null) {
  return WithdrawalRequest.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .session(session);
}

async function runAutomaticSettlements({ walletType }) {
  const actorId = 'system-cron';
  const actorRole = 'system';
  const periodLabel =
    walletType === 'vendor' ? 'Daily automated vendor settlement' : 'Daily automated rider settlement';

  if (walletType === 'vendor') {
    const storeIds = await Order.distinct('storeId', {
      orderStatus: 'delivered',
      paymentStatus: 'paid',
      payoutStatus: 'pending',
    });
    const successes = [];
    const failures = [];
    for (const storeId of storeIds) {
      try {
        const payout = await settleVendorWallet({
          storeId: storeId.toString(),
          processedBy: actorId,
          actorRole,
          periodLabel,
        });
        if (payout) {
          successes.push(payout.payoutId);
        }
      } catch (error) {
        failures.push({ target: storeId.toString(), error: error.message });
        await getOrCreateAdminWallet().then(async (wallet) => {
          wallet.failedSettlements = roundMoney(Number(wallet.failedSettlements || 0) + 1);
          await wallet.save();
        });
        await recordFinanceAudit({
          action: 'vendor_settlement',
          actorId,
          actorRole,
          status: 'failed',
          walletType: 'vendor',
          storeId: storeId.toString(),
          message: error.message,
        });
        await Order.updateMany(
          { storeId, payoutStatus: 'pending' },
          {
            $inc: { settlementFailureCount: 1 },
            $set: { lastSettlementError: error.message || 'Vendor settlement failed' },
          },
        );
      }
    }
    return { successes, failures };
  }

  const riderIds = await Order.distinct('riderId', {
    riderId: { $ne: '' },
    orderStatus: 'delivered',
    paymentStatus: 'paid',
    riderPayoutStatus: 'pending',
  });
  const successes = [];
  const failures = [];
  for (const riderId of riderIds) {
    try {
      const payout = await settleRiderWallet({
        riderId: riderId.toString(),
        processedBy: actorId,
        actorRole,
        periodLabel,
      });
      if (payout) {
        successes.push(payout.payoutId);
      }
    } catch (error) {
      failures.push({ target: riderId.toString(), error: error.message });
      await getOrCreateAdminWallet().then(async (wallet) => {
        wallet.failedSettlements = roundMoney(Number(wallet.failedSettlements || 0) + 1);
        await wallet.save();
      });
      await recordFinanceAudit({
        action: 'rider_settlement',
        actorId,
        actorRole,
        status: 'failed',
        walletType: 'rider',
        riderId: riderId.toString(),
        message: error.message,
      });
      await Order.updateMany(
        { riderId, riderPayoutStatus: 'pending' },
        {
          $inc: { settlementFailureCount: 1 },
          $set: { lastSettlementError: error.message || 'Rider settlement failed' },
        },
      );
    }
  }
  return { successes, failures };
}

module.exports = {
  approveWithdrawalRequest,
  calculateOrderFinancials,
  createWithdrawalRequest,
  financeConfig,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  listWithdrawalRequests,
  normalizedOrderIds,
  recordFinanceAudit,
  recordTransaction,
  rejectWithdrawalRequest,
  reverseOrderSettlement,
  roundMoney,
  runAutomaticSettlements,
  settleDeliveredOrder,
  settleRiderWallet,
  settleVendorWallet,
  runWithOptionalSession,
  withSession,
};
