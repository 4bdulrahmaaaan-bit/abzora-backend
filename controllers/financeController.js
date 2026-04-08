const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const {
  createWithdrawalRequest,
  financeConfig,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
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
    totalEarnings: Number(source.totalEarnings || 0),
    totalWithdrawn: Number(source.totalWithdrawn || 0),
    lastSettlementDate: source.lastSettlementDate || '',
    ...extra,
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
    const wallet = await getOrCreateVendorWallet(store._id.toString(), req.user.uid);
    const transactions = await Transaction.find({
      $or: [{ userType: 'vendor', userId: req.user.uid }, { storeId: store._id.toString() }],
    })
      .sort({ createdAt: -1, _id: -1 })
      .limit(25);
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(wallet, {
          storeId: store._id.toString(),
          commissionRate: Number(store.commissionRate || financeConfig().adminCommissionPercent),
        }),
        transactions: transactions.map(serializeTransaction),
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
    await createWithdrawalRequest({
      walletType: 'vendor',
      wallet,
      userId: req.user.uid,
      amount,
      note: 'Vendor withdrawal requested',
    });
    store.walletBalance = Number(wallet.balance || 0);
    await store.save();
    return res.status(200).json({ success: true, data: serializeWallet(wallet, { storeId: store._id.toString() }) });
  } catch (error) {
    return next(error);
  }
}

async function getRiderWallet(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const wallet = await getOrCreateRiderWallet(req.user.uid);
    const transactions = await Transaction.find({ userType: 'rider', userId: req.user.uid })
      .sort({ createdAt: -1, _id: -1 })
      .limit(25);
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(wallet, { riderId: req.user.uid }),
        transactions: transactions.map(serializeTransaction),
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
    await createWithdrawalRequest({
      walletType: 'rider',
      wallet,
      userId: req.user.uid,
      amount,
      note: 'Rider withdrawal requested',
    });
    return res.status(200).json({ success: true, data: serializeWallet(wallet, { riderId: req.user.uid }) });
  } catch (error) {
    return next(error);
  }
}

async function getAdminFinance(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const [adminWallet, vendorWallets, riderWallets, transactions] = await Promise.all([
      getOrCreateAdminWallet(),
      VendorWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      RiderWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      Transaction.find({}).sort({ createdAt: -1, _id: -1 }).limit(50),
    ]);

    const vendorPending = vendorWallets.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const riderPending = riderWallets.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        adminWallet: {
          totalCommission: Number(adminWallet.totalCommission || 0),
          totalRevenue: Number(adminWallet.totalRevenue || 0),
          payoutsDone: Number(adminWallet.payoutsDone || 0),
          vendorSettlementsDone: Number(adminWallet.vendorSettlementsDone || 0),
          riderSettlementsDone: Number(adminWallet.riderSettlementsDone || 0),
        },
        vendorPending,
        riderPending,
        vendorWallets: vendorWallets.map((wallet) => serializeWallet(wallet, { storeId: wallet.storeId, ownerId: wallet.ownerId })),
        riderWallets: riderWallets.map((wallet) => serializeWallet(wallet, { riderId: wallet.riderId })),
        transactions: transactions.map(serializeTransaction),
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
        periodLabel,
        orders,
      });
      if (!payout) {
        continue;
      }
      await Order.updateMany(
        { _id: { $in: orders.map((order) => order._id) } },
        { $set: { payoutStatus: 'processed', payoutProcessed: true, payoutId: payout.payoutId } },
      );
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
        periodLabel,
        orders,
      });
      if (!payout) {
        continue;
      }
      await Order.updateMany(
        { _id: { $in: orders.map((order) => order._id) } },
        { $set: { riderPayoutStatus: 'processed', riderPayoutId: payout.payoutId } },
      );
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

module.exports = {
  getAdminFinance,
  getRiderWallet,
  getVendorWallet,
  requestRiderWithdraw,
  requestVendorWithdraw,
  settleRiderPayouts,
  settleVendorPayouts,
};
