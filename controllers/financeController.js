const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const AdminPayout = require('../models/AdminPayout');
const FraudAlert = require('../models/FraudAlert');
const User = require('../models/User');
const {
  approveWithdrawalRequest,
  createWithdrawalRequest,
  financeConfig,
  getUserPayoutProfile,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  listWithdrawalRequests,
  markWithdrawalCompleted,
  markWithdrawalFailed,
  rejectWithdrawalRequest,
  runAutomaticSettlements,
  saveUserPayoutProfile,
  settleRiderWallet,
  settleVendorWallet,
} = require('../services/financeService');
const Store = require('../models/Store');
const VendorWallet = require('../models/VendorWallet');
const RiderWallet = require('../models/RiderWallet');
const { verifyWebhookSignature } = require('../services/razorpayPayoutService');

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

function serializePayoutProfile(profile) {
  const source = profile || {};
  return {
    methodType: source.methodType || '',
    accountHolderName: source.accountHolderName || '',
    upiId: source.upiId || '',
    bankAccountNumber: source.bankAccountNumber || '',
    bankIfsc: source.bankIfsc || '',
    bankName: source.bankName || '',
    razorpayContactId: source.razorpayContactId || '',
    razorpayFundAccountId: source.razorpayFundAccountId || '',
    lastSyncedAt: source.lastSyncedAt || '',
    isConfigured: Boolean(source.methodType),
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
    approvedAt: source.approvedAt || '',
    completedAt: source.completedAt || '',
    rejectionReason: source.rejectionReason || '',
    payoutMode: source.payoutMode || '',
    payoutId: source.payoutId || '',
    razorpayContactId: source.razorpayContactId || '',
    razorpayFundAccountId: source.razorpayFundAccountId || '',
    idempotencyKey: source.idempotencyKey || '',
    failureReason: source.failureReason || '',
    retryCount: Number(source.retryCount || 0),
    isSuspicious: Boolean(source.isSuspicious),
    reviewRequired: Boolean(source.reviewRequired),
    riskScore: Number(source.riskScore || 0),
    riskReasons: Array.isArray(source.riskReasons) ? source.riskReasons : [],
    auditOrderIds: Array.isArray(source.auditOrderIds) ? source.auditOrderIds : [],
    metadata: source.metadata || {},
  };
}

function serializeFraudAlert(item) {
  if (!item) {
    return null;
  }
  const source = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: source.alertId || source._id?.toString() || '',
    type: source.type || 'order',
    severity: source.severity || 'medium',
    status: source.status || 'open',
    userId: source.userId || '',
    storeId: source.storeId || '',
    riderId: source.riderId || '',
    orderId: source.orderId || '',
    withdrawalRequestId: source.withdrawalRequestId || '',
    refundRequestId: source.refundRequestId || '',
    riskScore: Number(source.riskScore || 0),
    reasons: Array.isArray(source.reasons) ? source.reasons : [],
    message: source.message || '',
    ipAddress: source.ipAddress || '',
    deviceId: source.deviceId || '',
    relatedOrderIds: Array.isArray(source.relatedOrderIds) ? source.relatedOrderIds : [],
    metadata: source.metadata || {},
    reviewedBy: source.reviewedBy || '',
    reviewedAt: source.reviewedAt || '',
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
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

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date = new Date()) {
  const dayStart = startOfDay(date);
  const offset = dayStart.getDay() === 0 ? 6 : dayStart.getDay() - 1;
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - offset);
}

function sameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function buildDailySeries({ items, amountFor, dateFor, days = 7, labelFormatter }) {
  return Array.from({ length: days }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (days - 1 - index));
    const value = items
      .filter((item) => {
        const date = dateFor(item);
        return date && sameDay(date, day);
      })
      .reduce((sum, item) => sum + Number(amountFor(item) || 0), 0);
    return {
      label: labelFormatter ? labelFormatter(day) : `${day.getDate()}`,
      value: Number(value || 0),
    };
  });
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
    const [wallet, transactions, withdrawalRequests, payoutProfile] = await Promise.all([
      getOrCreateVendorWallet(store._id.toString(), req.user.uid),
      Transaction.find({
        $or: [{ userType: 'vendor', userId: req.user.uid }, { storeId: store._id.toString() }],
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(25),
      listWithdrawalRequests({ storeId: store._id.toString() }).then((items) => items.slice(0, 10)),
      getUserPayoutProfile(req.user.uid).then((result) => result.profile),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(wallet, {
          storeId: store._id.toString(),
          commissionRate: Number(store.commissionRate || financeConfig().adminCommissionPercent),
        }),
        payoutProfile: serializePayoutProfile(payoutProfile),
        transactions: transactions.map(serializeTransaction),
        withdrawalRequests: withdrawalRequests.map(serializeWithdrawalRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getVendorDashboard(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }

    const [wallet, transactions, orders] = await Promise.all([
      getOrCreateVendorWallet(store._id.toString(), req.user.uid),
      Transaction.find({
        $or: [{ userType: 'vendor', userId: req.user.uid }, { storeId: store._id.toString() }],
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(12),
      Order.find({ storeId: store._id }).sort({ createdAt: -1, _id: -1 }).limit(250),
    ]);

    const now = new Date();
    const today = startOfDay(now);
    const weekStart = startOfWeek(now);
    const completedOrders = orders.filter((order) => order.orderStatus === 'delivered');
    const todayCompleted = completedOrders.filter((order) => {
      const date = order.updatedAt || order.createdAt;
      return date && sameDay(date, today);
    });

    const dailySeries = buildDailySeries({
      items: completedOrders,
      amountFor: (order) => order.vendorEarnings,
      dateFor: (order) => order.updatedAt || order.createdAt,
      days: 7,
      labelFormatter: (date) =>
        date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
    });

    const lastPayoutTransaction = transactions.find(
      (item) => item.type === 'payout' && ['completed', 'processed'].includes(String(item.status || '').toLowerCase()),
    );

    return res.status(200).json({
      success: true,
      data: {
        todayEarnings: todayCompleted.reduce((sum, order) => sum + Number(order.vendorEarnings || 0), 0),
        totalEarnings: Number(wallet.totalEarnings || 0),
        pendingAmount: Number(wallet.pendingAmount || 0),
        availableBalance: Number(wallet.balance || 0),
        reservedAmount: Number(wallet.reservedAmount || 0),
        lastPayoutAmount: Number(lastPayoutTransaction?.amount || 0),
        lastPayoutAt: lastPayoutTransaction?.createdAtIso || '',
        ordersCompleted: completedOrders.length,
        ordersToday: todayCompleted.length,
        weeklyEarnings: completedOrders
          .filter((order) => {
            const date = order.updatedAt || order.createdAt;
            return date && date >= weekStart;
          })
          .reduce((sum, order) => sum + Number(order.vendorEarnings || 0), 0),
        dailySeries,
        transactions: transactions.map(serializeTransaction),
        wallet: serializeWallet(wallet, {
          storeId: store._id.toString(),
          commissionRate: Number(store.commissionRate || financeConfig().adminCommissionPercent),
        }),
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

async function getVendorPayoutProfile(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const { profile } = await getUserPayoutProfile(req.user.uid);
    return res.status(200).json({ success: true, data: serializePayoutProfile(profile) });
  } catch (error) {
    return next(error);
  }
}

async function saveVendorPayoutProfile(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const store = await Store.findOne({ ownerId: req.user.uid });
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found.' });
    }
    const profile = await saveUserPayoutProfile({
      userId: req.user.uid,
      methodType: req.body?.methodType,
      accountHolderName: req.body?.accountHolderName,
      upiId: req.body?.upiId,
      bankAccountNumber: req.body?.bankAccountNumber,
      bankIfsc: req.body?.bankIfsc,
      bankName: req.body?.bankName,
    });
    return res.status(200).json({ success: true, data: serializePayoutProfile(profile) });
  } catch (error) {
    return next(error);
  }
}

async function getRiderWallet(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const [wallet, transactions, withdrawalRequests, payoutProfile] = await Promise.all([
      getOrCreateRiderWallet(req.user.uid),
      Transaction.find({ userType: 'rider', userId: req.user.uid })
        .sort({ createdAt: -1, _id: -1 })
        .limit(25),
      listWithdrawalRequests({ riderId: req.user.uid }).then((items) => items.slice(0, 10)),
      getUserPayoutProfile(req.user.uid).then((result) => result.profile),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        ...serializeWallet(wallet, { riderId: req.user.uid }),
        payoutProfile: serializePayoutProfile(payoutProfile),
        transactions: transactions.map(serializeTransaction),
        withdrawalRequests: withdrawalRequests.map(serializeWithdrawalRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getRiderDashboard(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const [wallet, transactions, orders] = await Promise.all([
      getOrCreateRiderWallet(req.user.uid),
      Transaction.find({ userType: 'rider', userId: req.user.uid })
        .sort({ createdAt: -1, _id: -1 })
        .limit(12),
      Order.find({ riderId: req.user.uid }).sort({ createdAt: -1, _id: -1 }).limit(250),
    ]);

    const now = new Date();
    const today = startOfDay(now);
    const deliveredOrders = orders.filter((order) => order.orderStatus === 'delivered');
    const todayDelivered = deliveredOrders.filter((order) => {
      const date = order.updatedAt || order.createdAt;
      return date && sameDay(date, today);
    });

    return res.status(200).json({
      success: true,
      data: {
        todayDeliveries: todayDelivered.length,
        earningsToday: todayDelivered.reduce((sum, order) => sum + Number(order.riderEarnings || 0), 0),
        totalEarnings: Number(wallet.totalEarnings || 0),
        pendingPayout: Number(wallet.pendingAmount || 0),
        availableBalance: Number(wallet.balance || 0),
        reservedAmount: Number(wallet.reservedAmount || 0),
        transactions: transactions.map(serializeTransaction),
        wallet: serializeWallet(wallet, { riderId: req.user.uid }),
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

async function getRiderPayoutProfile(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const { profile } = await getUserPayoutProfile(req.user.uid);
    return res.status(200).json({ success: true, data: serializePayoutProfile(profile) });
  } catch (error) {
    return next(error);
  }
}

async function saveRiderPayoutProfile(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const profile = await saveUserPayoutProfile({
      userId: req.user.uid,
      methodType: req.body?.methodType,
      accountHolderName: req.body?.accountHolderName,
      upiId: req.body?.upiId,
      bankAccountNumber: req.body?.bankAccountNumber,
      bankIfsc: req.body?.bankIfsc,
      bankName: req.body?.bankName,
    });
    return res.status(200).json({ success: true, data: serializePayoutProfile(profile) });
  } catch (error) {
    return next(error);
  }
}

async function getAdminFinance(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const [adminWallet, vendorWallets, riderWallets, transactions, withdrawalRequests, fraudAlerts, flaggedUsers] = await Promise.all([
      getOrCreateAdminWallet(),
      VendorWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      RiderWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      Transaction.find({}).sort({ createdAt: -1, _id: -1 }).limit(50),
      listWithdrawalRequests({ status: { $in: ['pending', 'manual_review', 'failed', 'processing'] } }),
      FraudAlert.find({ status: { $in: ['open', 'reviewing'] } }).sort({ createdAt: -1, _id: -1 }).limit(30),
      User.countDocuments({ isFlagged: true }),
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
        fraudAlerts: fraudAlerts.map(serializeFraudAlert),
        flaggedUsers,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateFraudAlertStatus(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const alertId = String(req.params?.alertId || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    if (!alertId) {
      return res.status(400).json({ success: false, message: 'alertId is required.' });
    }
    if (!['open', 'reviewing', 'resolved', 'ignored'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid fraud alert status.' });
    }
    const alert = await FraudAlert.findOne({ alertId });
    if (!alert) {
      return res.status(404).json({ success: false, message: 'Fraud alert not found.' });
    }
    alert.status = status;
    if (status === 'resolved' || status === 'ignored') {
      alert.reviewedBy = req.user.uid;
      alert.reviewedAt = new Date().toISOString();
    }
    await alert.save();
    return res.status(200).json({ success: true, data: serializeFraudAlert(alert) });
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

async function handleRazorpayPayoutWebhook(req, res, next) {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const event = String(payload?.event || '').trim();
    const payoutEntity = payload?.payload?.payout?.entity || {};
    const requestId =
      payoutEntity?.reference_id ||
      payoutEntity?.notes?.withdrawalRequestId ||
      '';
    const payoutId = payoutEntity?.id || '';
    const failureReason =
      payoutEntity?.status_details?.description ||
      payoutEntity?.status_details?.reason ||
      payoutEntity?.failure_reason ||
      'Payout failed.';

    if (event === 'payout.processed') {
      const request = await markWithdrawalCompleted({ payoutId, requestId });
      return res.status(200).json({
        success: true,
        data: serializeWithdrawalRequest(request),
      });
    }

    if (event === 'payout.failed') {
      const request = await markWithdrawalFailed({
        payoutId,
        requestId,
        reason: failureReason,
      });
      return res.status(200).json({
        success: true,
        data: serializeWithdrawalRequest(request),
      });
    }

    return res.status(200).json({ success: true, ignored: true, event });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  approvePendingWithdrawal,
  getAdminFinance,
  getRiderDashboard,
  getRiderWallet,
  getRiderPayoutProfile,
  getVendorDashboard,
  getVendorWallet,
  getVendorPayoutProfile,
  handleRazorpayPayoutWebhook,
  rejectPendingWithdrawal,
  requestRiderWithdraw,
  requestVendorWithdraw,
  runScheduledSettlements,
  saveRiderPayoutProfile,
  saveVendorPayoutProfile,
  settleRiderPayouts,
  settleVendorPayouts,
  updateFraudAlertStatus,
};
