const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const AdminPayout = require('../models/AdminPayout');
const PayoutRecoveryJob = require('../models/PayoutRecoveryJob');
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
  recordFinanceAudit,
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
const { claimWebhookDelivery } = require('../services/webhookLockService');
const { runPayoutRecoverySweep } = require('../services/payoutRecoveryService');
const { isAllowedAdminEmail } = require('./authController');
const { hasRole } = require('../middleware/authorizationMiddleware');

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function isVendorUser(user) {
  return hasRole(user, ['vendor']);
}

function isRiderUser(user) {
  return hasRole(user, ['rider']);
}

function ensureAdmin(req, res) {
  const privileged = hasRole(req.user, ['admin', 'super_admin']);
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!privileged && !emailAllowed) {
    res.status(403).json({ success: false, message: 'Admin access denied.' });
    return false;
  }
  return true;
}

function ensureVendor(req, res) {
  if (!req.user?.uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  if (!isVendorUser(req.user)) {
    res.status(403).json({ success: false, message: 'Vendor access required.' });
    return false;
  }
  return true;
}

function ensureRider(req, res) {
  if (!req.user?.uid) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return false;
  }
  if (!isRiderUser(req.user)) {
    res.status(403).json({ success: false, message: 'Rider access required.' });
    return false;
  }
  return true;
}

function serializeWallet(wallet, extra = {}) {
  if (!wallet) {
    return null;
  }
  const source = typeof wallet.toObject === 'function' ? wallet.toObject() : wallet;
  const balance = Number(source.balance || 0);
  const pendingAmount = Number(source.pendingAmount || 0);
  const reservedAmount = Number(source.reservedAmount || 0);
  const totalEarnings = Number(source.totalEarnings || 0);
  const totalWithdrawn = Number(source.totalWithdrawn || 0);
  const expectedBalance = roundMoney(totalEarnings - totalWithdrawn - pendingAmount - reservedAmount);
  return {
    balance,
    pendingAmount,
    reservedAmount,
    withdrawableBalance: roundMoney(Math.max(0, balance - reservedAmount)),
    totalEarnings,
    totalWithdrawn,
    lastSettlementDate: source.lastSettlementDate || '',
    reconciliation: {
      expectedBalance,
      actualBalance: balance,
      delta: roundMoney(balance - expectedBalance),
      ledgerTotal: roundMoney(balance + reservedAmount + pendingAmount + totalWithdrawn),
    },
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
    verificationStatus: source.verificationStatus || 'unverified',
    verifiedAt: source.verifiedAt || '',
    verificationReference: source.verificationReference || '',
    verificationMessage: source.verificationMessage || '',
    isConfigured: Boolean(source.methodType),
    isVerified: String(source.verificationStatus || '').toLowerCase() === 'verified' && Boolean(source.verificationReference),
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
    approvedBy: source.approvedBy || '',
    approvalLockId: source.approvalLockId || '',
    processingStartedAt: source.processingStartedAt || '',
    completedAt: source.completedAt || '',
    paidAt: source.paidAt || '',
    reversedAt: source.reversedAt || '',
    cancelledAt: source.cancelledAt || '',
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

async function recordPayoutWebhookAudit({
  action,
  status = 'success',
  request = null,
  amount = 0,
  message = '',
  metadata = {},
}) {
  try {
    await recordFinanceAudit({
      action,
      actorId: 'razorpayx-webhook',
      actorRole: 'system',
      walletType: request?.walletType || 'admin',
      userId: request?.userId || '',
      storeId: request?.storeId || '',
      riderId: request?.riderId || '',
      amount: Number(amount || request?.amount || 0),
      status,
      orderId: '',
      message,
      metadata,
    });
  } catch (error) {
    console.warn('Failed to record payout webhook audit:', error.message);
  }
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date = new Date()) {
  const dayStart = startOfDay(date);
  const offset = dayStart.getDay() === 0 ? 6 : dayStart.getDay() - 1;
  return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() - offset);
}

function toValidDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function sameDay(left, right) {
  const leftDate = toValidDate(left);
  const rightDate = toValidDate(right);
  if (!leftDate || !rightDate) {
    return false;
  }
  return (
    leftDate.getFullYear() === rightDate.getFullYear() &&
    leftDate.getMonth() === rightDate.getMonth() &&
    leftDate.getDate() === rightDate.getDate()
  );
}

function parseNumberOrNull(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildWithdrawalFilter(query = {}) {
  const filter = {};
  const status = String(query.status || '').trim().toLowerCase();
  const walletType = String(query.walletType || '').trim().toLowerCase();
  const userId = String(query.userId || '').trim();
  const storeId = String(query.storeId || '').trim();
  const riderId = String(query.riderId || '').trim();
  const from = toValidDate(query.from);
  const to = toValidDate(query.to);
  const minAmount = parseNumberOrNull(query.minAmount);
  const maxAmount = parseNumberOrNull(query.maxAmount);

  if (status && status !== 'all') {
    filter.status = status;
  }
  if (['vendor', 'rider'].includes(walletType)) {
    filter.walletType = walletType;
  }
  if (userId) {
    filter.userId = userId;
  }
  if (storeId) {
    filter.storeId = storeId;
  }
  if (riderId) {
    filter.riderId = riderId;
  }
  if (from || to) {
    filter.createdAt = {};
    if (from) {
      filter.createdAt.$gte = from;
    }
    if (to) {
      to.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = to;
    }
  }
  if (minAmount != null || maxAmount != null) {
    filter.amount = {};
    if (minAmount != null) {
      filter.amount.$gte = minAmount;
    }
    if (maxAmount != null) {
      filter.amount.$lte = maxAmount;
    }
  }
  return filter;
}

function summarizeWithdrawalRequests(items = []) {
  const summary = {
    pending: 0,
    approved: 0,
    processing: 0,
    paid: 0,
    failed: 0,
    reversed: 0,
    cancelled: 0,
    manual_review: 0,
    completed: 0,
    rejected: 0,
  };
  let totalAmount = 0;
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    }
    totalAmount += Number(item?.amount || 0);
  }
  return {
    ...summary,
    total: items.length,
    totalAmount: roundMoney(totalAmount),
  };
}

function buildRecoveryFilter(query = {}) {
  const filter = {};
  const status = String(query.status || '').trim().toLowerCase();
  const userRole = String(query.userRole || '').trim().toLowerCase();
  const withdrawalRequestId = String(query.withdrawalRequestId || '').trim();
  const payoutId = String(query.payoutId || '').trim();
  const from = toValidDate(query.from);
  const to = toValidDate(query.to);

  if (status && status !== 'all') {
    filter.status = status;
  }
  if (['vendor', 'rider', 'admin'].includes(userRole)) {
    filter.userRole = userRole;
  }
  if (withdrawalRequestId) {
    filter.withdrawalRequestId = withdrawalRequestId;
  }
  if (payoutId) {
    filter.razorpayPayoutId = payoutId;
  }
  if (from || to) {
    filter.updatedAt = {};
    if (from) {
      filter.updatedAt.$gte = from;
    }
    if (to) {
      to.setHours(23, 59, 59, 999);
      filter.updatedAt.$lte = to;
    }
  }
  return filter;
}

function summarizeRecoveryJobs(items = []) {
  const summary = {
    pending: 0,
    investigating: 0,
    recovered: 0,
    manual_review: 0,
    failed: 0,
    total: items.length,
  };
  for (const item of items) {
    const status = String(item?.status || '').trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(summary, status)) {
      summary[status] += 1;
    }
  }
  return summary;
}

function buildDailySeries({ items, amountFor, dateFor, days = 7, labelFormatter }) {
  return Array.from({ length: days }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (days - 1 - index));
    const value = items
      .filter((item) => {
        const date = toValidDate(dateFor(item));
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
    if (!ensureVendor(req, res)) {
      return;
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

async function getUserWalletSummary(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    const user = req.dbUser || (await User.findOne({ firebaseUid: req.user.uid }));
    return res.status(200).json({
      success: true,
      data: {
        userId: req.user.uid,
        walletBalance: Number(user?.walletBalance || 0),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getVendorDashboard(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
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
      (item) =>
        item.type === 'payout' &&
        ['paid', 'completed', 'processed'].includes(String(item.status || '').toLowerCase()),
    );
    const todayRevenue = todayCompleted.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const todayEarnings = todayCompleted.reduce((sum, order) => sum + Number(order.vendorEarnings || 0), 0);
    const todayCommission = todayCompleted.reduce((sum, order) => sum + Number(order.platformCommission || 0), 0);
    const weeklyCompleted = completedOrders.filter((order) => {
      const date = toValidDate(order.updatedAt || order.createdAt);
      return date && date >= weekStart;
    });
    const weeklyRevenue = weeklyCompleted.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
    const weeklyEarnings = weeklyCompleted.reduce((sum, order) => sum + Number(order.vendorEarnings || 0), 0);
    const weeklyCommission = weeklyCompleted.reduce(
      (sum, order) => sum + Number(order.platformCommission || 0),
      0,
    );

    return res.status(200).json({
      success: true,
      data: {
        todayRevenue,
        todayGrossRevenue: todayRevenue,
        todayEarnings,
        todayCommission,
        totalEarnings: Number(wallet.totalEarnings || 0),
        pendingAmount: Number(wallet.pendingAmount || 0),
        availableBalance: Number(wallet.balance || 0),
        reservedAmount: Number(wallet.reservedAmount || 0),
        lastPayoutAmount: Number(lastPayoutTransaction?.amount || 0),
        lastPayoutAt: lastPayoutTransaction?.createdAtIso || '',
        ordersCompleted: completedOrders.length,
        ordersToday: todayCompleted.length,
        totalSales: orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
        weeklyRevenue,
        weeklyGrossRevenue: weeklyRevenue,
        weeklyEarnings,
        weeklyCommission,
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
    if (!ensureVendor(req, res)) {
      return;
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
    if (!ensureVendor(req, res)) {
      return;
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
    if (!ensureVendor(req, res)) {
      return;
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
    if (!ensureRider(req, res)) {
      return;
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
    if (!ensureRider(req, res)) {
      return;
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
    if (!ensureRider(req, res)) {
      return;
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
    if (!ensureRider(req, res)) {
      return;
    }
    const { profile } = await getUserPayoutProfile(req.user.uid);
    return res.status(200).json({ success: true, data: serializePayoutProfile(profile) });
  } catch (error) {
    return next(error);
  }
}

async function saveRiderPayoutProfile(req, res, next) {
  try {
    if (!ensureRider(req, res)) {
      return;
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
    const [adminWallet, vendorWallets, riderWallets, transactions, withdrawalRequests, fraudAlerts, flaggedUsers, recoveryJobSummary] = await Promise.all([
      getOrCreateAdminWallet(),
      VendorWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      RiderWallet.find({}).sort({ updatedAt: -1 }).limit(50),
      Transaction.find({}).sort({ createdAt: -1, _id: -1 }).limit(50),
      listWithdrawalRequests({ status: { $in: ['pending', 'manual_review', 'approved', 'processing', 'paid', 'failed', 'reversed', 'cancelled', 'completed', 'rejected'] } }),
      FraudAlert.find({ status: { $in: ['open', 'reviewing'] } }).sort({ createdAt: -1, _id: -1 }).limit(30),
      User.countDocuments({ isFlagged: true }),
      PayoutRecoveryJob.aggregate([
        {
          $group: {
            _id: { $toLower: '$status' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);

    const vendorPending = vendorWallets.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const riderPending = riderWallets.reduce((sum, item) => sum + Number(item.pendingAmount || 0), 0);
    const pendingWithdrawalAmount = withdrawalRequests
      .filter((item) => ['pending', 'manual_review', 'approved', 'processing'].includes(String(item.status || '').toLowerCase()))
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const withdrawalSummary = summarizeWithdrawalRequests(withdrawalRequests);
    const payoutRecoverySummary = {
      pending: 0,
      investigating: 0,
      recovered: 0,
      manual_review: 0,
      failed: 0,
      total: 0,
    };
    for (const row of recoveryJobSummary) {
      const key = String(row?._id || '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(payoutRecoverySummary, key)) {
        payoutRecoverySummary[key] = Number(row.count || 0);
      }
      payoutRecoverySummary.total += Number(row.count || 0);
    }

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
        withdrawalSummary,
        payoutRecoverySummary,
        vendorWallets: vendorWallets.map((wallet) =>
          serializeWallet(wallet, { storeId: wallet.storeId, ownerId: wallet.ownerId }),
        ),
        riderWallets: riderWallets.map((wallet) =>
          serializeWallet(wallet, { riderId: wallet.riderId }),
        ),
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

async function listAdminWithdrawals(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const filter = buildWithdrawalFilter(req.query);
    const [items, totalCount, statusTotals] = await Promise.all([
      WithdrawalRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      WithdrawalRequest.countDocuments(filter),
      WithdrawalRequest.aggregate([
        { $match: filter },
        {
          $group: {
            _id: { $toLower: '$status' },
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
          },
        },
      ]),
    ]);
    const summary = {
      pending: 0,
      approved: 0,
      processing: 0,
      paid: 0,
      failed: 0,
      reversed: 0,
      cancelled: 0,
      manual_review: 0,
      completed: 0,
      rejected: 0,
      total: totalCount,
      totalAmount: 0,
    };
    for (const row of statusTotals) {
      const key = String(row?._id || '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        summary[key] = Number(row.count || 0);
      }
      summary.totalAmount = roundMoney(summary.totalAmount + Number(row.totalAmount || 0));
    }
    return res.status(200).json({
      success: true,
      data: items.map(serializeWithdrawalRequest),
      summary,
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function exportAdminWithdrawalsCsv(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const filter = buildWithdrawalFilter(req.query);
    const items = await WithdrawalRequest.find(filter).sort({ createdAt: -1, _id: -1 }).limit(10000);
    const rows = [
      [
        'requestId',
        'walletType',
        'status',
        'userId',
        'storeId',
        'riderId',
        'amount',
        'requestedAt',
        'approvedAt',
        'processingStartedAt',
        'completedAt',
        'paidAt',
        'failureReason',
        'rejectionReason',
        'payoutId',
      ].join(','),
      ...items.map((item) =>
        [
          item.requestId,
          item.walletType,
          item.status,
          item.userId,
          item.storeId || '',
          item.riderId || '',
          Number(item.amount || 0),
          item.requestedAt || '',
          item.approvedAt || '',
          item.processingStartedAt || '',
          item.completedAt || '',
          item.paidAt || '',
          String(item.failureReason || '').replaceAll(',', ' '),
          String(item.rejectionReason || '').replaceAll(',', ' '),
          item.payoutId || '',
        ].join(','),
      ),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="abzora-withdrawals.csv"');
    return res.status(200).send(rows.join('\n'));
  } catch (error) {
    return next(error);
  }
}

async function exportAdminWithdrawalsXlsx(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    let ExcelJS;
    try {
      // Lazy load so the API still boots if the Excel dependency changes.
      // eslint-disable-next-line global-require
      ExcelJS = require('exceljs');
    } catch (_) {
      return res.status(500).json({
        success: false,
        message: 'XLSX export dependency missing. Install exceljs in backend.',
      });
    }
    const filter = buildWithdrawalFilter(req.query);
    const items = await WithdrawalRequest.find(filter).sort({ createdAt: -1, _id: -1 }).limit(10000);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Withdrawals');
    sheet.columns = [
      { header: 'Request ID', key: 'requestId', width: 22 },
      { header: 'Wallet Type', key: 'walletType', width: 12 },
      { header: 'Status', key: 'status', width: 14 },
      { header: 'User ID', key: 'userId', width: 18 },
      { header: 'Store ID', key: 'storeId', width: 18 },
      { header: 'Rider ID', key: 'riderId', width: 18 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Requested At', key: 'requestedAt', width: 24 },
      { header: 'Approved At', key: 'approvedAt', width: 24 },
      { header: 'Processing Started At', key: 'processingStartedAt', width: 24 },
      { header: 'Completed At', key: 'completedAt', width: 24 },
      { header: 'Paid At', key: 'paidAt', width: 24 },
      { header: 'Payout ID', key: 'payoutId', width: 22 },
      { header: 'Failure Reason', key: 'failureReason', width: 34 },
    ];
    items.forEach((item) => {
      sheet.addRow({
        requestId: item.requestId,
        walletType: item.walletType,
        status: item.status,
        userId: item.userId,
        storeId: item.storeId || '',
        riderId: item.riderId || '',
        amount: Number(item.amount || 0),
        requestedAt: item.requestedAt || '',
        approvedAt: item.approvedAt || '',
        processingStartedAt: item.processingStartedAt || '',
        completedAt: item.completedAt || '',
        paidAt: item.paidAt || '',
        payoutId: item.payoutId || '',
        failureReason: item.failureReason || '',
      });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="abzora-withdrawals.xlsx"');
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    return next(error);
  }
}

function serializeRecoveryJob(item) {
  if (!item) {
    return null;
  }
  const source = typeof item.toObject === 'function' ? item.toObject() : item;
  return {
    id: source._id?.toString() || '',
    withdrawalRequestId: source.withdrawalRequestId || '',
    userId: source.userId || '',
    userRole: source.userRole || '',
    razorpayPayoutId: source.razorpayPayoutId || '',
    status: source.status || 'pending',
    attemptCount: Number(source.attemptCount || 0),
    lastCheckedAt: source.lastCheckedAt || '',
    resolvedAt: source.resolvedAt || '',
    failureReason: source.failureReason || '',
    metadata: source.metadata || {},
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function getPayoutRecoveryJobs(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query?.limit, 10) || 50));
    const skip = (page - 1) * limit;
    const filter = buildRecoveryFilter(req.query);
    const [items, totalCount, statusTotals] = await Promise.all([
      PayoutRecoveryJob.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit),
      PayoutRecoveryJob.countDocuments(filter),
      PayoutRecoveryJob.aggregate([
        { $match: filter },
        {
          $group: {
            _id: { $toLower: '$status' },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    const summary = {
      pending: 0,
      investigating: 0,
      recovered: 0,
      manual_review: 0,
      failed: 0,
      total: totalCount,
    };
    for (const row of statusTotals) {
      const key = String(row?._id || '').trim().toLowerCase();
      if (Object.prototype.hasOwnProperty.call(summary, key)) {
        summary[key] = Number(row.count || 0);
      }
    }
    return res.status(200).json({
      success: true,
      data: items.map(serializeRecoveryJob),
      summary,
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function runPayoutRecoveryNow(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const staleMinutes = Math.max(1, parseInt(req.body?.staleMinutes, 10) || 5);
    const limit = Math.min(500, Math.max(1, parseInt(req.body?.limit, 10) || 100));
    const result = await runPayoutRecoverySweep({
      staleMinutes,
      limit,
      triggeredBy: req.user?.uid || 'admin-recovery',
    });
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function retryPayoutRecoveryJob(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const jobId = String(req.params?.jobId || '').trim();
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required.' });
    }
    const job = await PayoutRecoveryJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Recovery job not found.' });
    }
    const request = await WithdrawalRequest.findOne({ requestId: job.withdrawalRequestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }
    const { recoverSingleWithdrawal } = require('../services/payoutRecoveryService');
    const outcome = await recoverSingleWithdrawal(request, {
      staleMinutes: 0,
      triggeredBy: req.user?.uid || 'admin-recovery',
    });
    return res.status(200).json({
      success: true,
      data: {
        job: serializeRecoveryJob(outcome.job || job),
        resolved: Boolean(outcome.resolved),
        reason: outcome.reason || '',
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function _applyManualRecoveryDecision({
  job,
  request,
  decision,
  reason = '',
  processedBy = 'admin-recovery',
  finalStatus = 'failed',
}) {
  if (!job || !request) {
    throw new Error('Recovery job and withdrawal request are required.');
  }

  if (decision === 'paid') {
    const updatedRequest = await markWithdrawalCompleted({
      requestId: request.requestId,
      payoutId: request.payoutId,
      processedBy,
    });
    job.status = 'recovered';
    job.failureReason = '';
    job.resolvedAt = new Date().toISOString();
    job.lastCheckedAt = job.resolvedAt;
    job.metadata = new Map(
      Object.entries({
        ...(job.metadata ? Object.fromEntries(job.metadata) : {}),
        resolutionMethod: 'manual_mark_paid',
        resolutionNote: reason,
        statusBefore: request.status || '',
        statusAfter: updatedRequest?.status || 'paid',
      }).map(([key, value]) => [key, String(value ?? '')]),
    );
    await job.save();
    return updatedRequest;
  }

  const safeFinalStatus = ['reversed', 'cancelled', 'failed'].includes(finalStatus)
    ? finalStatus
    : 'failed';
  const updatedRequest = await markWithdrawalFailed({
    requestId: request.requestId,
    payoutId: request.payoutId,
    reason: reason || 'Marked failed by admin recovery review.',
    processedBy,
    finalStatus: safeFinalStatus,
  });
  job.status = safeFinalStatus === 'failed' ? 'failed' : 'manual_review';
  job.failureReason = reason || 'Marked failed by admin recovery review.';
  job.resolvedAt = new Date().toISOString();
  job.lastCheckedAt = job.resolvedAt;
  job.metadata = new Map(
    Object.entries({
      ...(job.metadata ? Object.fromEntries(job.metadata) : {}),
      resolutionMethod: 'manual_mark_failed',
      resolutionNote: reason,
      statusBefore: request.status || '',
      statusAfter: updatedRequest?.status || safeFinalStatus,
    }).map(([key, value]) => [key, String(value ?? '')]),
  );
  await job.save();
  return updatedRequest;
}

async function markPayoutRecoveryJobPaid(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const jobId = String(req.params?.jobId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required.' });
    }
    const job = await PayoutRecoveryJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Recovery job not found.' });
    }
    const request = await WithdrawalRequest.findOne({ requestId: job.withdrawalRequestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }
    const updatedRequest = await _applyManualRecoveryDecision({
      job,
      request,
      decision: 'paid',
      reason,
      processedBy: req.user?.uid || 'admin-recovery',
    });
    return res.status(200).json({
      success: true,
      data: {
        job: serializeRecoveryJob(job),
        request: serializeWithdrawalRequest(updatedRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function markPayoutRecoveryJobFailed(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const jobId = String(req.params?.jobId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    const finalStatus = String(req.body?.finalStatus || 'failed').trim().toLowerCase();
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required.' });
    }
    const job = await PayoutRecoveryJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Recovery job not found.' });
    }
    const request = await WithdrawalRequest.findOne({ requestId: job.withdrawalRequestId });
    if (!request) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }
    const updatedRequest = await _applyManualRecoveryDecision({
      job,
      request,
      decision: 'failed',
      reason,
      processedBy: req.user?.uid || 'admin-recovery',
      finalStatus,
    });
    return res.status(200).json({
      success: true,
      data: {
        job: serializeRecoveryJob(job),
        request: serializeWithdrawalRequest(updatedRequest),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function escalatePayoutRecoveryJob(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const jobId = String(req.params?.jobId || '').trim();
    const reason = String(req.body?.reason || '').trim();
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required.' });
    }
    const job = await PayoutRecoveryJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Recovery job not found.' });
    }
    job.status = 'manual_review';
    job.failureReason = reason || 'Escalated to finance review.';
    job.lastCheckedAt = new Date().toISOString();
    job.metadata = new Map(
      Object.entries({
        ...(job.metadata ? Object.fromEntries(job.metadata) : {}),
        resolutionMethod: 'escalated',
        resolutionNote: reason,
      }).map(([key, value]) => [key, String(value ?? '')]),
    );
    await job.save();
    return res.status(200).json({
      success: true,
      data: serializeRecoveryJob(job),
    });
  } catch (error) {
    return next(error);
  }
}

async function addPayoutRecoveryJobNote(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const jobId = String(req.params?.jobId || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!jobId) {
      return res.status(400).json({ success: false, message: 'jobId is required.' });
    }
    if (!note) {
      return res.status(400).json({ success: false, message: 'note is required.' });
    }
    const job = await PayoutRecoveryJob.findById(jobId);
    if (!job) {
      return res.status(404).json({ success: false, message: 'Recovery job not found.' });
    }
    const metadata = job.metadata ? Object.fromEntries(job.metadata) : {};
    job.metadata = new Map(
      Object.entries({
        ...metadata,
        internalNote: note,
        noteUpdatedAt: new Date().toISOString(),
        noteUpdatedBy: req.user?.uid || 'admin-recovery',
      }).map(([key, value]) => [key, String(value ?? '')]),
    );
    job.lastCheckedAt = new Date().toISOString();
    await job.save();
    await recordFinanceAudit({
      action: 'payout_recovery_note',
      actorId: req.user?.uid || 'admin-recovery',
      actorRole: 'admin',
      status: 'success',
      walletType: 'admin',
      withdrawalRequestId: job.withdrawalRequestId,
      payoutId: job.razorpayPayoutId || '',
      amount: 0,
      message: note,
    });
    return res.status(200).json({
      success: true,
      data: serializeRecoveryJob(job),
    });
  } catch (error) {
    return next(error);
  }
}

async function exportPayoutRecoveryJobsCsv(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    const filter = buildRecoveryFilter(req.query);
    const items = await PayoutRecoveryJob.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(10000);
    const rows = [
      [
        'withdrawalRequestId',
        'userId',
        'userRole',
        'razorpayPayoutId',
        'status',
        'attemptCount',
        'lastCheckedAt',
        'resolvedAt',
        'failureReason',
      ].join(','),
      ...items.map((item) =>
        [
          item.withdrawalRequestId,
          item.userId,
          item.userRole,
          item.razorpayPayoutId,
          item.status,
          Number(item.attemptCount || 0),
          item.lastCheckedAt || '',
          item.resolvedAt || '',
          String(item.failureReason || '').replaceAll(',', ' '),
        ].join(','),
      ),
    ];
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="abzora-payout-recovery.csv"');
    return res.status(200).send(rows.join('\n'));
  } catch (error) {
    return next(error);
  }
}

async function exportPayoutRecoveryJobsXlsx(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) {
      return;
    }
    let ExcelJS;
    try {
      // Lazy load so base API stays healthy if the export dependency changes.
      // eslint-disable-next-line global-require
      ExcelJS = require('exceljs');
    } catch (_) {
      return res.status(500).json({
        success: false,
        message: 'XLSX export dependency missing. Install exceljs in backend.',
      });
    }
    const filter = buildRecoveryFilter(req.query);
    const items = await PayoutRecoveryJob.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(10000);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Payout Recovery');
    sheet.columns = [
      { header: 'Withdrawal Request ID', key: 'withdrawalRequestId', width: 24 },
      { header: 'User ID', key: 'userId', width: 18 },
      { header: 'User Role', key: 'userRole', width: 12 },
      { header: 'Razorpay Payout ID', key: 'razorpayPayoutId', width: 24 },
      { header: 'Status', key: 'status', width: 16 },
      { header: 'Attempt Count', key: 'attemptCount', width: 14 },
      { header: 'Last Checked At', key: 'lastCheckedAt', width: 24 },
      { header: 'Resolved At', key: 'resolvedAt', width: 24 },
      { header: 'Failure Reason', key: 'failureReason', width: 34 },
    ];
    items.forEach((item) => {
      sheet.addRow({
        withdrawalRequestId: item.withdrawalRequestId,
        userId: item.userId,
        userRole: item.userRole,
        razorpayPayoutId: item.razorpayPayoutId || '',
        status: item.status,
        attemptCount: Number(item.attemptCount || 0),
        lastCheckedAt: item.lastCheckedAt || '',
        resolvedAt: item.resolvedAt || '',
        failureReason: item.failureReason || '',
      });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="abzora-payout-recovery.xlsx"');
    await workbook.xlsx.write(res);
    return res.end();
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
      await recordPayoutWebhookAudit({
        action: 'payout_webhook_invalid_signature',
        status: 'failed',
        message: 'Invalid RazorpayX payout webhook signature.',
        metadata: {
          event: String(req.body?.event || '').trim(),
        },
      });
      return res.status(400).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventId = payload?.payload?.payout?.entity?.id || payload?.created_at || '';
    const firstDelivery = await claimWebhookDelivery({
      source: 'razorpay-payout',
      rawBody,
      eventId,
      signature,
    });
    if (!firstDelivery) {
      return res.status(200).json({ success: true, duplicate: true });
    }
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
    const failedEvents = new Set(['payout.failed', 'payout.rejected', 'payout.cancelled', 'payout.reversed', 'payout.returned']);

    if (event === 'payout.processed') {
      const request = await markWithdrawalCompleted({ payoutId, requestId });
      await recordPayoutWebhookAudit({
        action: 'payout_webhook_processed',
        request,
        amount: request?.amount || 0,
        message: `Processed RazorpayX payout webhook event: ${event}.`,
        metadata: { event, payoutId, requestId },
      });
      return res.status(200).json({
        success: true,
        data: serializeWithdrawalRequest(request),
      });
    }

    if (failedEvents.has(event)) {
      const finalStatus =
        event === 'payout.cancelled'
          ? 'cancelled'
          : event === 'payout.reversed' || event === 'payout.returned'
            ? 'reversed'
            : 'failed';
      const request = await markWithdrawalFailed({
        payoutId,
        requestId,
        reason: failureReason,
        finalStatus,
      });
      await recordPayoutWebhookAudit({
        action: 'payout_webhook_failed',
        status: finalStatus === 'failed' ? 'failed' : 'success',
        request,
        amount: request?.amount || 0,
        message: failureReason,
        metadata: { event, payoutId, requestId, finalStatus },
      });
      return res.status(200).json({
        success: true,
        data: serializeWithdrawalRequest(request),
      });
    }

    await recordPayoutWebhookAudit({
      action: 'payout_webhook_ignored',
      message: `Ignored unsupported RazorpayX payout webhook event: ${event || 'unknown'}.`,
      metadata: { event, payoutId, requestId },
    });
    return res.status(200).json({ success: true, ignored: true, event });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  approvePendingWithdrawal,
  exportAdminWithdrawalsCsv,
  exportAdminWithdrawalsXlsx,
  exportPayoutRecoveryJobsCsv,
  exportPayoutRecoveryJobsXlsx,
  addPayoutRecoveryJobNote,
  escalatePayoutRecoveryJob,
  getUserWalletSummary,
  getAdminFinance,
  getPayoutRecoveryJobs,
  getRiderDashboard,
  getRiderWallet,
  getRiderPayoutProfile,
  getVendorDashboard,
  getVendorWallet,
  getVendorPayoutProfile,
  handleRazorpayPayoutWebhook,
  listAdminWithdrawals,
  rejectPendingWithdrawal,
  requestRiderWithdraw,
  requestVendorWithdraw,
  retryPayoutRecoveryJob,
  markPayoutRecoveryJobFailed,
  markPayoutRecoveryJobPaid,
  runPayoutRecoveryNow,
  runScheduledSettlements,
  saveRiderPayoutProfile,
  saveVendorPayoutProfile,
  settleRiderPayouts,
  settleVendorPayouts,
  updateFraudAlertStatus,
};
