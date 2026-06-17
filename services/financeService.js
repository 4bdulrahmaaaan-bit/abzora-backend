const mongoose = require('mongoose');

const AdminPayout = require('../models/AdminPayout');
const AdminWallet = require('../models/AdminWallet');
const FinanceAuditLog = require('../models/FinanceAuditLog');
const Order = require('../models/Order');
const RiderWallet = require('../models/RiderWallet');
const Store = require('../models/Store');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const VendorWallet = require('../models/VendorWallet');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const {
  createFraudAlert,
  evaluateWithdrawalRisk,
  mergeUserFraudFlags,
  toSeverity,
} = require('./fraudDetectionService');
const {
  createOrUpdateContact,
  createOrUpdateFundAccount,
  createPayout,
} = require('./razorpayPayoutService');
const { calculateOrderPricing } = require('./pricingService');

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

function normalizePayoutMode(methodType) {
  return methodType === 'vpa' ? 'UPI' : 'IMPS';
}

const WITHDRAWAL_STATE_TRANSITIONS = {
  pending: new Set(['approved', 'manual_review', 'cancelled', 'failed']),
  manual_review: new Set(['approved', 'cancelled', 'failed']),
  approved: new Set(['processing', 'cancelled', 'failed']),
  processing: new Set(['paid', 'failed', 'reversed', 'cancelled']),
  paid: new Set([]),
  failed: new Set(['approved', 'manual_review', 'cancelled']),
  reversed: new Set([]),
  cancelled: new Set([]),
  completed: new Set(['paid']),
  rejected: new Set(['cancelled']),
};

function canTransitionWithdrawalStatus(current, next) {
  const from = String(current || '').trim().toLowerCase();
  const to = String(next || '').trim().toLowerCase();
  return Boolean(WITHDRAWAL_STATE_TRANSITIONS[from]?.has(to));
}

function assertWithdrawalTransition(current, next, context = '') {
  if (!canTransitionWithdrawalStatus(current, next)) {
    const suffix = context ? ` (${context})` : '';
    throw new Error(`Illegal withdrawal transition${suffix}: ${String(current || 'unknown')} -> ${String(next || 'unknown')}.`);
  }
}

function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeVerificationStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['verified', 'pending', 'failed', 'unverified'].includes(status)) {
    return status;
  }
  return 'unverified';
}

function validateBankIfsc(bankIfsc) {
  return /^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(bankIfsc || '').trim().toUpperCase());
}

function validateBankAccountNumber(bankAccountNumber) {
  return /^[0-9]{6,18}$/.test(String(bankAccountNumber || '').replace(/\s+/g, ''));
}

function validateUpiId(upiId) {
  return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(String(upiId || '').trim());
}

function validateAccountHolderName(accountHolderName) {
  const normalized = normalizeText(accountHolderName);
  return normalized.length >= 2 && /[A-Za-z]/.test(normalized);
}

function normalizePayoutProfile(profile = {}) {
  return {
    methodType: String(profile.methodType || '').trim(),
    accountHolderName: normalizeText(profile.accountHolderName),
    upiId: normalizeText(profile.upiId),
    bankAccountNumber: normalizeText(profile.bankAccountNumber),
    bankIfsc: String(profile.bankIfsc || '').trim().toUpperCase(),
    bankName: normalizeText(profile.bankName),
    razorpayContactId: normalizeText(profile.razorpayContactId),
    razorpayFundAccountId: normalizeText(profile.razorpayFundAccountId),
    lastSyncedAt: normalizeText(profile.lastSyncedAt),
    verificationStatus: normalizeVerificationStatus(profile.verificationStatus),
    verifiedAt: normalizeText(profile.verifiedAt),
    verificationReference: normalizeText(profile.verificationReference),
    verificationMessage: normalizeText(profile.verificationMessage),
  };
}

function validatePayoutProfile(profile = {}) {
  const normalized = normalizePayoutProfile(profile);
  const methodType = normalized.methodType.toLowerCase();
  if (!['vpa', 'bank_account'].includes(methodType)) {
    throw new Error('methodType must be vpa or bank_account.');
  }
  if (!validateAccountHolderName(normalized.accountHolderName)) {
    throw new Error('Account holder name is required.');
  }
  if (methodType === 'vpa') {
    if (!validateUpiId(normalized.upiId)) {
      throw new Error('Valid UPI ID is required.');
    }
    normalized.bankAccountNumber = '';
    normalized.bankIfsc = '';
    normalized.bankName = '';
  } else {
    if (!validateBankAccountNumber(normalized.bankAccountNumber)) {
      throw new Error('Valid bank account number is required.');
    }
    if (!validateBankIfsc(normalized.bankIfsc)) {
      throw new Error('Valid IFSC is required.');
    }
    normalized.upiId = '';
    normalized.bankIfsc = normalized.bankIfsc.toUpperCase();
  }
  normalized.methodType = methodType;
  return normalized;
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
  const calculated = calculateOrderPricing({
    orderValue: subtotalAmount,
    taxAmount,
    distanceKm: deliveryDistanceKm,
    storeCommissionRate:
      commissionPercent == null || Number.isNaN(Number(commissionPercent))
        ? financeConfig().adminCommissionPercent
        : Number(commissionPercent),
  });

  if (deliveryFee == null) {
    return calculated;
  }

  const safeDeliveryFee = roundMoney(deliveryFee);
  const safeSubtotal = roundMoney(subtotalAmount);
  const safeTax = roundMoney(taxAmount);
  const resolvedCommissionPercent = Number(calculated.commissionPercent || 0);
  const platformCommission = roundMoney(safeSubtotal * resolvedCommissionPercent);

  return {
    ...calculated,
    deliveryFee: safeDeliveryFee,
    platformCommission,
    vendorEarnings: roundMoney(Math.max(0, safeSubtotal - platformCommission)),
    totalAmount: roundMoney(
      Math.max(0, safeSubtotal + safeTax + safeDeliveryFee + Number(calculated.tryAtHomeFee || 0) - Number(calculated.discountAmount || 0)),
    ),
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

function serializePayoutProfile(profile = {}) {
  const source = normalizePayoutProfile(profile);
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
    isVerified: source.verificationStatus === 'verified' && Boolean(source.verificationReference),
  };
}

async function getUserPayoutProfile(userId, session = null) {
  const user = await User.findOne({ uid: userId }).session(session);
  if (!user) {
    throw new Error('User not found for payout profile.');
  }
  return {
    user,
    profile: serializePayoutProfile(user.payoutProfile || {}),
  };
}

async function saveUserPayoutProfile({
  userId,
  methodType,
  accountHolderName,
  upiId,
  bankAccountNumber,
  bankIfsc,
  bankName,
}) {
  return runWithOptionalSession(async (session) => {
    const user = await User.findOne({ uid: userId }).session(session);
    if (!user) {
      throw new Error('User not found.');
    }

    const profile = validatePayoutProfile({
      methodType,
      accountHolderName: accountHolderName || user.name || '',
      upiId,
      bankAccountNumber,
      bankIfsc,
      bankName,
      razorpayContactId: user.payoutProfile?.razorpayContactId || '',
      razorpayFundAccountId: user.payoutProfile?.razorpayFundAccountId || '',
      verificationStatus: 'pending',
      verifiedAt: '',
      verificationReference: '',
      verificationMessage: '',
    });
    profile.verificationStatus = 'pending';
    profile.verifiedAt = '';
    profile.verificationReference = '';
    profile.verificationMessage = '';
    profile.lastSyncedAt = '';

    user.payoutProfile = profile;
    await user.save(withSession({}, session));
    return serializePayoutProfile(user.payoutProfile || {});
  });
}

async function ensureUserPayoutRecipient({ userId, walletType, session = null }) {
  const { user, profile } = await getUserPayoutProfile(userId, session);
  const normalizedProfile = validatePayoutProfile(profile);
  if (!normalizedProfile.methodType) {
    throw new Error('Beneficiary payout details are not configured.');
  }

  if (
    normalizedProfile.verificationStatus === 'verified' &&
    normalizedProfile.razorpayContactId &&
    normalizedProfile.razorpayFundAccountId &&
    normalizedProfile.verificationReference
  ) {
    return {
      user,
      profile: serializePayoutProfile(normalizedProfile),
    };
  }

  let contact;
  let fundAccount;
  try {
    contact = await createOrUpdateContact({
      name: normalizedProfile.accountHolderName || user.name || 'Abianzo Beneficiary',
      email: user.email || '',
      phone: user.phone || '',
      userType: walletType,
      existingContactId: normalizedProfile.razorpayContactId || '',
    });

    fundAccount = await createOrUpdateFundAccount({
      contactId: contact.id,
      methodType: normalizedProfile.methodType,
      accountHolderName: normalizedProfile.accountHolderName || user.name || 'Abianzo Beneficiary',
      upiId: normalizedProfile.upiId,
      bankAccountNumber: normalizedProfile.bankAccountNumber,
      bankIfsc: normalizedProfile.bankIfsc,
      bankName: normalizedProfile.bankName,
      existingFundAccountId: normalizedProfile.razorpayFundAccountId || '',
    });
  } catch (error) {
    normalizedProfile.verificationStatus = 'failed';
    normalizedProfile.verificationMessage = error.message || 'Payout account verification failed.';
    normalizedProfile.lastSyncedAt = nowIso();
    user.payoutProfile = normalizedProfile;
    await user.save(withSession({}, session));
    throw error;
  }

  normalizedProfile.razorpayContactId = contact.id;
  normalizedProfile.razorpayFundAccountId = fundAccount.id;
  normalizedProfile.lastSyncedAt = nowIso();
  normalizedProfile.verificationStatus = 'verified';
  normalizedProfile.verifiedAt = nowIso();
  normalizedProfile.verificationReference = `contact:${contact.id}|fund:${fundAccount.id}`;
  normalizedProfile.verificationMessage = '';
  user.payoutProfile = normalizedProfile;
  await user.save(withSession({}, session));

  return {
    user,
    profile: serializePayoutProfile(normalizedProfile),
  };
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
    const alreadyReleased =
      (freshOrder.escrowStatus || '').toLowerCase() === 'released' &&
      freshOrder.commissionRecorded &&
      freshOrder.vendorCredited &&
      (!freshOrder.riderId || freshOrder.riderCredited);
    if (alreadyReleased) {
      return freshOrder;
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

    freshOrder.escrowStatus = 'released';
    freshOrder.escrowReleasedAt = freshOrder.escrowReleasedAt || currentIso;
    freshOrder.escrowUpdatedAt = currentIso;
    freshOrder.lastSettlementError = '';

    await Promise.all([
      vendorWallet.save(withSession({}, session)),
      adminWallet.save(withSession({}, session)),
      freshOrder.save(withSession({}, session)),
      recordTransaction(
        {
          type: 'escrow',
          userType: 'admin',
          userId: 'primary',
          amount: Number(freshOrder.totalAmount || 0),
          status: 'released',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          riderId: freshOrder.riderId || '',
          note: 'Escrow released to pending earnings wallets after delivery.',
        },
        session,
      ),
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
          message: 'Escrow released after delivery; earnings moved to pending wallets.',
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
      recordTransaction(
        {
          type: 'escrow',
          userType: 'admin',
          userId: 'primary',
          amount: -Math.abs(Number(freshOrder.totalAmount || 0)),
          status: 'reversed',
          orderId: freshOrder._id.toString(),
          storeId: freshOrder.storeId.toString(),
          riderId: freshOrder.riderId || '',
          note: reason,
        },
        session,
      ),
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
    const user = await User.findOne({ uid: userId }).session(session);
    const existingOpenRequest = await WithdrawalRequest.findOne({
      walletType,
      userId,
      status: { $in: ['pending', 'manual_review', 'approved', 'processing'] },
    }).session(session);
    if (existingOpenRequest) {
      throw new Error('An existing withdrawal request is already in progress.');
    }
    const freshWallet = walletType === 'vendor'
      ? await VendorWallet.findById(wallet._id).session(session)
      : await RiderWallet.findById(wallet._id).session(session);
    if (!freshWallet) {
      throw new Error('Wallet not found for withdrawal.');
    }
    if (safeAmount > Number(freshWallet.balance || 0)) {
      throw new Error('Insufficient balance for withdrawal.');
    }

    const { profile: payoutProfile } = await ensureUserPayoutRecipient({
      userId,
      walletType,
      session,
    });
    const withdrawalRisk = await evaluateWithdrawalRisk({
      user,
      wallet: freshWallet,
      walletType,
      amount: safeAmount,
    });
    if (withdrawalRisk.decision === 'block') {
      freshWallet.balance = roundMoney(Number(freshWallet.balance || 0) + safeAmount);
      freshWallet.reservedAmount = roundMoney(
        Math.max(0, Number(freshWallet.reservedAmount || 0) - safeAmount),
      );
      await freshWallet.save(withSession({}, session));
      if (walletType === 'vendor' && freshWallet.storeId) {
        await Store.findByIdAndUpdate(
          freshWallet.storeId,
          { $set: { walletBalance: freshWallet.balance } },
          withSession({}, session),
        );
      }
      await mergeUserFraudFlags(userId, {
        score: withdrawalRisk.riskScore,
        reasons: withdrawalRisk.reasons,
      });
      await createFraudAlert({
        type: 'withdrawal',
        severity: toSeverity(withdrawalRisk.riskScore),
        userId,
        storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
        riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
        riskScore: withdrawalRisk.riskScore,
        reasons: withdrawalRisk.reasons,
        message: 'Withdrawal blocked by risk rules.',
      });
      throw new Error('Withdrawal request blocked for security review.');
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
          status: withdrawalRisk.decision === 'review' ? 'manual_review' : 'pending',
          userId,
          storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
          riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
          amount: safeAmount,
          note,
          requestedAt: nowIso(),
          payoutMode: normalizePayoutMode(payoutProfile.methodType),
          metadata: {
            threshold: minimum,
            payoutMethodType: payoutProfile.methodType,
            payoutConfigured: Boolean(payoutProfile.methodType),
            payoutVerificationStatus: payoutProfile.verificationStatus || 'unverified',
          },
          isSuspicious: withdrawalRisk.decision === 'review',
          reviewRequired: withdrawalRisk.decision === 'review',
          riskScore: withdrawalRisk.riskScore,
          riskReasons: withdrawalRisk.reasons,
        },
      ],
      withSession({}, session),
    );
    if (withdrawalRisk.decision === 'review') {
      await mergeUserFraudFlags(userId, {
        score: withdrawalRisk.riskScore,
        reasons: withdrawalRisk.reasons,
      });
      await createFraudAlert({
        type: 'withdrawal',
        severity: toSeverity(withdrawalRisk.riskScore),
        userId,
        storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
        riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
        withdrawalRequestId: request.requestId,
        riskScore: withdrawalRisk.riskScore,
        reasons: withdrawalRisk.reasons,
        message: 'Withdrawal moved to manual review.',
      });
    }

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: walletType,
          userId,
          amount: safeAmount,
          status: withdrawalRisk.decision === 'review' ? 'manual_review' : 'requested',
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
          status: withdrawalRisk.decision === 'review' ? 'review' : 'requested',
          walletType,
          storeId: walletType === 'vendor' ? freshWallet.storeId || '' : '',
          riderId: walletType === 'rider' ? freshWallet.riderId || '' : '',
          withdrawalRequestId: request.requestId,
          amount: safeAmount,
          message: withdrawalRisk.decision === 'review'
            ? `Withdrawal queued for manual review. ${note}`.trim()
            : note,
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
    if (['paid', 'completed', 'failed', 'reversed', 'cancelled'].includes(request.status)) {
      return request;
    }
    if (request.status === 'processing' && request.payoutId) {
      return request;
    }
    if (request.status === 'approved' && request.approvalLockId && !request.payoutId) {
      throw new Error('This withdrawal request is already being processed.');
    }
    if (!['pending', 'manual_review', 'failed'].includes(request.status)) {
      throw new Error('This withdrawal request cannot be approved again.');
    }
    assertWithdrawalTransition(request.status, 'approved', 'approval_claim');

    const wasFailed = request.status === 'failed';
    const approvalLockId = buildId(`withdrawal-lock-${request.requestId}`);
    const approvedAt = nowIso();
    const idempotencyKey = request.idempotencyKey || buildId(`payout-${request.requestId}`);
    const payoutMode = request.payoutMode || 'IMPS';

    const claimedRequest = await WithdrawalRequest.findOneAndUpdate(
      {
        requestId,
        status: { $in: ['pending', 'manual_review', 'failed'] },
      },
      {
        $set: {
          status: 'approved',
          approvedAt,
          approvedBy: processedBy,
          processedBy,
          approvalLockId,
          idempotencyKey,
          payoutMode,
          failureReason: '',
        },
      },
      { new: true },
    ).session(session);
    if (!claimedRequest) {
      const current = await WithdrawalRequest.findOne({ requestId }).session(session);
      if (current && current.status === 'processing' && current.payoutId) {
        return current;
      }
      if (current && current.status === 'approved' && current.approvalLockId) {
        throw new Error('This withdrawal request is already being processed.');
      }
      throw new Error('This withdrawal request cannot be approved again.');
    }

    const wallet = claimedRequest.walletType === 'vendor'
      ? await VendorWallet.findOne({ storeId: claimedRequest.storeId }).session(session)
      : await RiderWallet.findOne({ riderId: claimedRequest.riderId }).session(session);
    if (!wallet) {
      throw new Error('Linked wallet not found.');
    }
    const requestedAmount = Number(claimedRequest.amount || 0);
    const reservedAmount = Number(wallet.reservedAmount || 0);
    if (reservedAmount < requestedAmount) {
      if (!wasFailed) {
        throw new Error('Reserved withdrawal balance is inconsistent.');
      }
      const topUp = roundMoney(requestedAmount - reservedAmount);
      if (topUp > Number(wallet.balance || 0)) {
        throw new Error('Insufficient balance to retry this withdrawal.');
      }
      wallet.balance = roundMoney(Number(wallet.balance || 0) - topUp);
      wallet.reservedAmount = roundMoney(reservedAmount + topUp);
      await wallet.save(withSession({}, session));
      if (request.walletType === 'vendor' && request.storeId) {
        await Store.findByIdAndUpdate(
          request.storeId,
          { $set: { walletBalance: wallet.balance } },
          withSession({}, session),
        );
      }
    }

    const { profile } = await ensureUserPayoutRecipient({
      userId: claimedRequest.userId,
      walletType: claimedRequest.walletType,
      session,
    });

    claimedRequest.status = 'processing';
    assertWithdrawalTransition('approved', 'processing', 'payout_initiation');
    claimedRequest.processingStartedAt = nowIso();
    claimedRequest.processedAt = claimedRequest.processingStartedAt;
    claimedRequest.processedBy = processedBy;
    claimedRequest.approvedAt = approvedAt;
    claimedRequest.approvedBy = processedBy;
    claimedRequest.approvalLockId = approvalLockId;
    claimedRequest.payoutMode = normalizePayoutMode(profile.methodType);
    claimedRequest.payoutId = claimedRequest.payoutId || '';
    claimedRequest.razorpayContactId = profile.razorpayContactId || '';
    claimedRequest.razorpayFundAccountId = profile.razorpayFundAccountId || '';
    claimedRequest.idempotencyKey = idempotencyKey;
    claimedRequest.failureReason = '';
    if (wasFailed) {
      claimedRequest.retryCount = Number(claimedRequest.retryCount || 0) + 1;
    }
    await claimedRequest.save(withSession({}, session));

    let payout;
    try {
      payout = await createPayout({
        fundAccountId: profile.razorpayFundAccountId,
        amount: Number(claimedRequest.amount || 0),
        mode: claimedRequest.payoutMode,
        referenceId: claimedRequest.requestId,
        idempotencyKey,
        narration: `${claimedRequest.walletType} withdrawal`,
        notes: {
          withdrawalRequestId: claimedRequest.requestId,
          walletType: claimedRequest.walletType,
          userId: claimedRequest.userId,
          storeId: claimedRequest.storeId || '',
          riderId: claimedRequest.riderId || '',
          approvalLockId,
        },
      });
    } catch (error) {
      await markWithdrawalFailed({
        requestId: claimedRequest.requestId,
        reason: error.message || 'Payout initiation failed.',
        processedBy,
      });
      throw error;
    }

    claimedRequest.payoutId = payout.id || claimedRequest.payoutId || '';
    await claimedRequest.save(withSession({}, session));

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: claimedRequest.walletType,
          userId: claimedRequest.userId,
          amount: Number(claimedRequest.amount || 0),
          status: 'processing',
          payoutId: claimedRequest.payoutId || claimedRequest.requestId,
          storeId: claimedRequest.storeId || '',
          riderId: claimedRequest.riderId || '',
          note: 'Withdrawal approved and sent to RazorpayX',
          metadata: {
            withdrawalRequestId: claimedRequest.requestId,
            fundAccountId: claimedRequest.razorpayFundAccountId || '',
            payoutMode: claimedRequest.payoutMode,
          },
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_processing',
          actorId: processedBy,
          actorRole,
          status: 'approved',
          walletType: claimedRequest.walletType,
          storeId: claimedRequest.storeId || '',
          riderId: claimedRequest.riderId || '',
          withdrawalRequestId: claimedRequest.requestId,
          payoutId: claimedRequest.payoutId || '',
          amount: Number(claimedRequest.amount || 0),
          message: 'Withdrawal approved and payout initiated.',
          metadata: {
            payoutMode: claimedRequest.payoutMode,
            razorpayContactId: claimedRequest.razorpayContactId || '',
            razorpayFundAccountId: claimedRequest.razorpayFundAccountId || '',
            approvalLockId,
          },
        },
        session,
      ),
    ]);

    return claimedRequest;
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
    if (!['pending', 'manual_review', 'failed', 'approved'].includes(request.status)) {
      throw new Error('This withdrawal request can no longer be rejected.');
    }
    assertWithdrawalTransition(request.status, 'cancelled', 'rejection');

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

    request.status = 'cancelled';
    request.processedAt = nowIso();
    request.processedBy = processedBy;
    request.cancelledAt = request.processedAt;
    request.approvalLockId = '';
    request.rejectionReason = reason;
    await request.save(withSession({}, session));

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: request.walletType,
          userId: request.userId,
          amount: -Math.abs(Number(request.amount || 0)),
          status: 'cancelled',
          payoutId: request.requestId,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          note: reason || 'Withdrawal cancelled',
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_cancelled',
          actorId: processedBy,
          actorRole,
          status: 'success',
          walletType: request.walletType,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          withdrawalRequestId: request.requestId,
          amount: Number(request.amount || 0),
          message: reason || 'Withdrawal cancelled.',
        },
        session,
      ),
    ]);

    return request;
  });
}

async function markWithdrawalCompleted({ payoutId, requestId, processedBy = 'razorpay-webhook' }) {
  return runWithOptionalSession(async (session) => {
    const request = await WithdrawalRequest.findOne({
      $or: [{ payoutId }, { requestId }],
    }).session(session);
    if (!request) {
      throw new Error('Withdrawal request not found for payout completion.');
    }
    if (['paid', 'completed'].includes(request.status)) {
      return request;
    }
    assertWithdrawalTransition(request.status, 'paid', 'webhook_completion');

    const wallet = request.walletType === 'vendor'
      ? await VendorWallet.findOne({ storeId: request.storeId }).session(session)
      : await RiderWallet.findOne({ riderId: request.riderId }).session(session);
    if (!wallet) {
      throw new Error('Linked wallet not found for payout completion.');
    }

    wallet.reservedAmount = roundMoney(
      Math.max(0, Number(wallet.reservedAmount || 0) - Number(request.amount || 0)),
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

    request.status = 'paid';
    request.paidAt = nowIso();
    request.completedAt = nowIso();
    request.processedAt = request.completedAt;
    request.processedBy = processedBy;
    request.payoutId = payoutId || request.payoutId || '';
    request.failureReason = '';
    request.approvalLockId = '';
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
          status: 'paid',
          payoutId: request.payoutId || request.requestId,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          note: 'Withdrawal paid successfully.',
          metadata: {
            withdrawalRequestId: request.requestId,
            processedBy,
          },
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_completed',
          actorId: processedBy,
          actorRole: 'system',
          status: 'success',
          walletType: request.walletType,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          withdrawalRequestId: request.requestId,
          payoutId: request.payoutId || '',
          amount: Number(request.amount || 0),
          message: 'Withdrawal payout completed.',
        },
        session,
      ),
    ]);

    return request;
  });
}

async function markWithdrawalFailed({
  payoutId,
  requestId,
  reason,
  processedBy = 'razorpay-webhook',
  finalStatus = 'failed',
}) {
  return runWithOptionalSession(async (session) => {
    const request = await WithdrawalRequest.findOne({
      $or: [{ payoutId }, { requestId }],
    }).session(session);
    if (!request) {
      throw new Error('Withdrawal request not found for payout failure.');
    }
    if (['paid', 'completed'].includes(request.status)) {
      return request;
    }
    if (!canTransitionWithdrawalStatus(request.status, 'failed') && !canTransitionWithdrawalStatus(request.status, 'reversed') && !canTransitionWithdrawalStatus(request.status, 'cancelled')) {
      throw new Error(`Illegal withdrawal transition for failure resolution: ${request.status} -> failed.`);
    }

    const wallet = request.walletType === 'vendor'
      ? await VendorWallet.findOne({ storeId: request.storeId }).session(session)
      : await RiderWallet.findOne({ riderId: request.riderId }).session(session);
    if (wallet) {
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
    }

    const nextStatus = ['reversed', 'cancelled', 'failed'].includes(finalStatus) ? finalStatus : 'failed';
    assertWithdrawalTransition(request.status, nextStatus, 'failure_resolution');
    request.status = nextStatus;
    request.processedAt = nowIso();
    request.processedBy = processedBy;
    request.payoutId = payoutId || request.payoutId || '';
    request.failureReason = reason || 'Payout failed.';
    request.approvalLockId = '';
    if (request.status === 'reversed') {
      request.reversedAt = request.processedAt;
    }
    if (request.status === 'cancelled') {
      request.cancelledAt = request.processedAt;
    }
    await request.save(withSession({}, session));

    const adminWallet = await getOrCreateAdminWallet(session);
    adminWallet.failedSettlements = roundMoney(Number(adminWallet.failedSettlements || 0) + 1);
    await adminWallet.save(withSession({}, session));

    await Promise.all([
      recordTransaction(
        {
          type: 'payout',
          userType: request.walletType,
          userId: request.userId,
          amount: Number(request.amount || 0),
          status: request.status,
          payoutId: request.payoutId || request.requestId,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          note: reason || 'Withdrawal payout failed.',
          metadata: {
            withdrawalRequestId: request.requestId,
            processedBy,
          },
        },
        session,
      ),
      recordFinanceAudit(
        {
          action: 'withdrawal_failed',
          actorId: processedBy,
          actorRole: 'system',
          status: request.status === 'failed' ? 'failed' : 'success',
          walletType: request.walletType,
          storeId: request.storeId || '',
          riderId: request.riderId || '',
          withdrawalRequestId: request.requestId,
          payoutId: request.payoutId || '',
          amount: Number(request.amount || 0),
          message: reason || 'Withdrawal payout failed.',
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
  getUserPayoutProfile,
  getOrCreateAdminWallet,
  getOrCreateRiderWallet,
  getOrCreateVendorWallet,
  listWithdrawalRequests,
  markWithdrawalCompleted,
  markWithdrawalFailed,
  normalizedOrderIds,
  recordFinanceAudit,
  recordTransaction,
  rejectWithdrawalRequest,
  reverseOrderSettlement,
  roundMoney,
  runAutomaticSettlements,
  saveUserPayoutProfile,
  settleDeliveredOrder,
  settleRiderWallet,
  settleVendorWallet,
  runWithOptionalSession,
  withSession,
};
