const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const {
  approveWithdrawalRequest,
  createWithdrawalRequest,
  financeConfig,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  listWithdrawalRequests,
  rejectWithdrawalRequest,
  runAutomaticSettlements,
  settleRiderWallet,
  settleVendorWallet,
} = require('../services/financeService');
const Store = require('../models/Store');
const VendorWallet = require('../models/VendorWallet');
const RiderWallet = require('../models/RiderWallet');

function ensureAdmin(req, res) {
  if (!['admin', 'super_admin'].includes(req.user?.role)) {
    res.status(403).json({ success: false, message: 'Admin access denied.' });
    return false;
  }
  return true;
}

function serializeWallet(wallet, extra = {}) {
  if (!wallet) {
    return null;
  }
  const source = typeof wallet.toObject === 'function' ? wallet.toObject() : wallet;
  return {
    balance: Number(source.balance || 0),
    pendingAmount: Number(source.pendingAmount || 0),
    reservedAmount: Number(source.reservedAmount || 0),
    totalEarnings: Number(source.totalEarnings || 0),
    totalWithdrawn: Number(source.totalWithdrawn || 0),
    lastSettlementDate: source.lastSettlementDate || '',
    ...extra,
  };
}

function serializeWithdrawalRequest(item) {
  if (!item) {
    return null;
  }
  const source = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: source.requestId || source._id?.toString() || '',
    walletType: source.walletType || 'vendor',
    status: source.status || 'pending',
    userId: source.userId || '',
    storeId: source.storeId || '',
    riderId: source.riderId || '',
    amount: Number(source.amount || 0),
    note: source.note || '',
    requestedAt: source.requestedAt || source.createdAt || '',
    processedAt: source.processedAt || '',
    processedBy: source.processedBy || '',
    rejectionReason: source.rejectionReason || '',
    auditOrderIds: Array.isArray(source.auditOrderIds) ? source.auditOrderIds : [],
    metadata: source.metadata || {},
  };
}

function serializeTransaction(item) {
  if (!item) {
    return null;
  }
  const source = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: source.transactionId || source._id?.toString() || '',
    type: source.type || 'order',
    userType: source.userType || 'vendor',
    userId: source.userId || '',
    amount: Number(source.amount || 0),
    status: source.status || 'pending',
    note: source.note || '',
    orderId: source.orderId || '',
    payoutId: source.payoutId || '',
    storeId: source.storeId || '',
    riderId: source.riderId || '',
    createdAt: source.createdAtIso || source.createdAt || null,
    metadata: source.metadata || {},
  };
}

async function getVendorWallet(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const [wallet, transactions, withdrawalRequests] = await Promise.all([
      getOrCreateVendorWallet(store._id.toString(), req.user.uid),
      Transaction.find({
        $or: [{ userType: 'vendor', userId: req.user.uid }, { storeId: store._id.toString() }],
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(25),
      listWithdrawalRequests({ storeId: store._id.toString() }).then((items) => items.slice(0, 10)),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(wallet, {
          storeId: store._id.toString(),
          commissionRate: Number(store.commissionRate || financeConfig().adminCommissionPercent),
        }),
        transactions: transactions.map(serializeTransaction),
        withdrawalRequests: withdrawalRequests.map(serializeWithdrawalRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function requestVendorWithdraw(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const amount = Number(req.body?.amount || 0);
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const wallet = await getOrCreateVendorWallet(store._id.toString(), req.user.uid);
    const result = await createWithdrawalRequest({
      walletType: 'vendor',
      wallet,
      userId: req.user.uid,
      amount,
      note: 'Vendor withdrawal requested and awaiting admin approval',
    });
    store.walletBalance = Number(result.wallet.balance || 0);
    await store.save();
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(result.wallet, { storeId: store._id.toString() }),
        withdrawalRequest: serializeWithdrawalRequest(result.request),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getRiderWallet(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const [wallet, transactions, withdrawalRequests] = await Promise.all([
      getOrCreateRiderWallet(req.user.uid),
      Transaction.find({ userType: 'rider', userId: req.user.uid })
        .sort({ createdAt: -1, _id: -1 })
        .limit(25),
      listWithdrawalRequests({ riderId: req.user.uid }).then((items) => items.slice(0, 10)),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(wallet, { riderId: req.user.uid }),
        transactions: transactions.map(serializeTransaction),
        withdrawalRequests: withdrawalRequests.map(serializeWithdrawalRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function requestRiderWithdraw(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const amount = Number(req.body?.amount || 0);
    const wallet = await getOrCreateRiderWallet(req.user.uid);
    const result = await createWithdrawalRequest({
      walletType: 'rider',
      wallet,
      userId: req.user.uid,
      amount,
      note: 'Rider withdrawal requested and awaiting admin approval',
    });
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(result.wallet, { riderId: req.user.uid }),
        withdrawalRequest: serializeWithdrawalRequest(result.request),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getAdminFinance(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const [adminWallet, vendorWallets, riderWallets, transactions, withdrawalRequests] = await Promise.all([
      getOrCreateAdminWallet(),
      VendorWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      RiderWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      Transaction.find({}).sort({ createdAt: -1, _id: -1 }).limit(50),
      listWithdrawalRequests({ status: 'pending' }),
    ]);

    const vendorPending = vendorWallets.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const riderPending = riderWallets.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const pendingWithdrawalAmount = withdrawalRequests.reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    );

    return res.status(200).json({
      success: true,
      data: {
        adminWallet: {
          totalCommission: Number(adminWallet.totalCommission || 0),
          totalRevenue: Number(adminWallet.totalRevenue || 0),
          payoutsDone: Number(adminWallet.payoutsDone || 0),
          vendorSettlementsDone: Number(adminWallet.vendorSettlementsDone || 0),
          riderSettlementsDone: Number(adminWallet.riderSettlementsDone || 0),
          failedSettlements: Number(adminWallet.failedSettlements || 0),
        },
        vendorPending,
        riderPending,
        pendingWithdrawalAmount,
        vendorWallets: vendorWallets.map((wallet) => serializeWallet(wallet, { storeId: wallet.storeId, ownerId: wallet.ownerId })),
        riderWallets: riderWallets.map((wallet) => serializeWallet(wallet, { riderId: wallet.riderId })),
        transactions: transactions.map(serializeTransaction),
        withdrawalRequests: withdrawalRequests.map(serializeWithdrawalRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function settleVendorPayouts(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const storeId = String(req.body?.storeId || '').trim();
    const periodLabel = String(req.body?.periodLabel || 'Vendor settlement').trim();
    const stores = storeId ? [await Store.findById(storeId)] : await Store.find({});
    const settled = [];
    for (const store of stores) {
      if (!store) {
        continue;
      }
      const orders = await Order.find({
        storeId: store._id,
        orderStatus: 'delivered',
        paymentStatus: 'paid',
        payoutStatus: 'pending',
      });
      if (orders.length === 0) {
        continue;
      }
      const payout = await settleVendorWallet({
        storeId: store._id.toString(),
        processedBy: req.user.uid,
        actorRole: req.user.role || 'admin',
        periodLabel,
        orders,
      });
      if (!payout) {
        continue;
      }
      settled.push({
        payoutId: payout.payoutId,
        storeId: store._id.toString(),
        amount: Number(payout.amount || 0),
        orderCount: orders.length,
      });
    }
    return res.status(200).json({ success: true, data: settled });
  } catch (error) {
    return next(error);
  }
}

async function settleRiderPayouts(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const riderId = String(req.body?.riderId || '').trim();
    const periodLabel = String(req.body?.periodLabel || 'Rider settlement').trim();
    const riderIds = riderId
      ? [riderId]
      : await Order.distinct('riderId', {
          riderId: { $ne: '' },
          orderStatus: 'delivered',
          paymentStatus: 'paid',
          riderPayoutStatus: 'pending',
        });
    const settled = [];
    for (const currentRiderId of riderIds) {
      if (!currentRiderId) {
        continue;
      }
      const orders = await Order.find({
        riderId: currentRiderId,
        orderStatus: 'delivered',
        paymentStatus: 'paid',
        riderPayoutStatus: 'pending',
      });
      if (orders.length == 0) {
        continue;
      }
      const payout = await settleRiderWallet({
        riderId: currentRiderId,
        processedBy: req.user.uid,
        actorRole: req.user.role || 'admin',
        periodLabel,
        orders,
      });
      if (!payout) {
        continue;
      }
      settled.push({
        payoutId: payout.payoutId,
        riderId: currentRiderId,
        amount: Number(payout.amount || 0),
        orderCount: orders.length,
      });
    }
    return res.status(200).json({ success: true, data: settled });
  } catch (error) {
    return next(error);
  }
}

async function approvePendingWithdrawal(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const requestId = String(req.params?.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required.' });
    }
    const request = await approveWithdrawalRequest({
      requestId,
      processedBy: req.user.uid,
      actorRole: req.user.role || 'admin',
    });
    return res.status(200).json({ success: true, data: serializeWithdrawalRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function rejectPendingWithdrawal(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const requestId = String(req.params?.requestId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!requestId) {
      return res.status(400).json({ success: false, message: 'requestId is required.' });
    }
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }
    const request = await rejectWithdrawalRequest({
      requestId,
      processedBy: req.user.uid,
      reason,
      actorRole: req.user.role || 'admin',
    });
    return res.status(200).json({ success: true, data: serializeWithdrawalRequest(request) });
  } catch (error) {
    return next(error);
  }
}

async function runScheduledSettlements(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const walletType = String(req.body?.walletType || '').trim().toLowerCase();
    if (!['vendor', 'rider'].includes(walletType)) {
      return res.status(400).json({ success: false, message: 'walletType must be vendor or rider.' });
    }
    const result = await runAutomaticSettlements({ walletType });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  approvePendingWithdrawal,
  getAdminFinance,
  getRiderWallet,
  getVendorWallet,
  rejectPendingWithdrawal,
  requestRiderWithdraw,
  requestVendorWithdraw,
  runScheduledSettlements,
  settleRiderPayouts,
  settleVendorPayouts,
};
