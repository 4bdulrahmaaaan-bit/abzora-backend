const TrialHomeSession = require('../models/TrialHomeSession');
const Product = require('../models/Product');
const Store = require('../models/Store');
const AdminPlatformSettings = require('../models/AdminPlatformSettings');
const User = require('../models/User');
const { hasRole } = require('../middleware/authorizationMiddleware');

const VALID_SESSION_STATUSES = new Set([
  'draft',
  'booked',
  'confirmed',
  'out_for_trial_delivery',
  'trial_in_progress',
  'completed',
  'converted_to_order',
  'converted_to_tailoring',
  'cancelled',
]);

const VALID_PAYMENT_STATUSES = new Set(['pending', 'held', 'refunded', 'waived']);
const VALID_FEEDBACK_FITS = new Set(['perfect', 'too_tight', 'too_loose', 'not_shared']);
const FINAL_SESSION_STATUSES = new Set([
  'completed',
  'converted_to_order',
  'converted_to_tailoring',
  'cancelled',
]);

function normalizeItem(item = {}, source = 'selected') {
  return {
    productId: item.productId?.toString().trim() || item.id?.toString().trim() || '',
    name: item.name?.toString().trim() || 'ABZORA Item',
    imageUrl: item.imageUrl?.toString().trim() || item.image?.toString().trim() || '',
    price: Number(item.price || 0),
    recommendedSize: item.recommendedSize?.toString().trim() || item.size?.toString().trim() || '',
    fitConfidence: Number(item.fitConfidence || item.matchScore || 0),
    styledForYou: item.styledForYou === true,
    source,
  };
}

function ensureValidItems(items = [], source = 'selected') {
  const normalized = (Array.isArray(items) ? items : [])
    .map((item) => normalizeItem(item, source))
    .filter((item) => item.productId);

  if (normalized.length === 0 || normalized.length > 5) {
    const error = new Error('Please provide between 1 and 5 trial-home items.');
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function normalizeSessionStatus(status, fallback = 'booked') {
  const normalized = status?.toString().trim() || '';
  return VALID_SESSION_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizePaymentStatus(status, fallback = 'pending') {
  const normalized = status?.toString().trim() || '';
  return VALID_PAYMENT_STATUSES.has(normalized) ? normalized : fallback;
}

function normalizeFeedbackFit(fit, fallback = 'not_shared') {
  const normalized = fit?.toString().trim() || '';
  return VALID_FEEDBACK_FITS.has(normalized) ? normalized : fallback;
}

function ensureMutableSession(session, actionLabel) {
  if (FINAL_SESSION_STATUSES.has(session.status)) {
    const error = new Error(`This trial-home session can no longer be ${actionLabel}.`);
    error.statusCode = 409;
    throw error;
  }
}

function uniqueStrings(items = []) {
  return [...new Set(items.map((item) => item.toString().trim()).filter(Boolean))];
}

function pushEvent(session, type, actorId, note = '') {
  session.events.push({
    type,
    actorId: actorId?.toString().trim() || '',
    note,
    createdAt: new Date(),
  });
}

function serializeTrialHomeSession(session) {
  if (!session) {
    return null;
  }

  const source = typeof session.toObject === 'function' ? session.toObject() : session;
  return {
    id: source._id?.toString() || source.id || '',
    userId: source.userId || '',
    status: source.status || 'booked',
    approvalStatus: source.approvalStatus || 'approved',
    approvedBy: source.approvedBy || '',
    approvalReason: source.approvalReason || '',
    items: source.items || [],
    recommendedItems: source.recommendedItems || [],
    addressLabel: source.addressLabel || '',
    deliverySlot: source.deliverySlot || '',
    deliveryWindowLabel: source.deliveryWindowLabel || '',
    experienceType: source.experienceType || 'premium',
    trialFee: source.trialFee ?? 99,
    trialFeeRefundable: source.trialFeeRefundable !== false,
    paymentStatus: source.paymentStatus || 'pending',
    subtotal: source.subtotal ?? 0,
    keptItems: source.keptItems || [],
    returnedItems: source.returnedItems || [],
    convertedOrderId: source.convertedOrderId || '',
    tailoringRequest: source.tailoringRequest || '',
    feedback: source.feedback || {},
    events: source.events || [],
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
    userName: source.userName || '',
    userPhone: source.userPhone || '',
    userCity: source.userCity || '',
    userTrialScore: source.userTrialScore ?? 0,
    userRiskScore: source.userRiskScore ?? 0,
    userFlagged: source.userFlagged === true,
  };
}

async function resolveVendorStoreId(actor = {}) {
  const declaredStoreId = actor?.storeId?.toString().trim() || '';
  if (declaredStoreId) {
    return declaredStoreId;
  }
  const ownStore = await Store.findOne({ ownerId: actor?.uid || '' });
  return ownStore?._id?.toString() || '';
}

async function resolveVendorProductIds(actor = {}) {
  const storeId = await resolveVendorStoreId(actor);
  if (!storeId || !/^[a-f0-9]{24}$/i.test(storeId)) {
    return [];
  }
  const products = await Product.find({ storeId }).select('_id');
  return products.map((product) => product._id.toString());
}

function sessionBelongsToVendor(session, productIdSet) {
  const itemIds = (session.items || [])
    .map((item) => item.productId?.toString().trim())
    .filter(Boolean);
  return itemIds.length > 0 && itemIds.every((id) => productIdSet.has(id));
}

async function enrichSessionsWithUsers(sessions = []) {
  if (sessions.length === 0) {
    return sessions;
  }
  const userIds = [...new Set(sessions.map((session) => session.userId).filter(Boolean))];
  const users = await User.find({ uid: { $in: userIds } }).select(
    'uid name phone city userTrialScore riskScore isFlagged',
  );
  const userById = new Map(users.map((user) => [user.uid, user]));
  return sessions.map((session) => {
    const source = session.toObject();
    const user = userById.get(source.userId);
    return {
      ...source,
      userName: user?.name || '',
      userPhone: user?.phone || '',
      userCity: user?.city || '',
      userTrialScore: Number(user?.userTrialScore ?? 0),
      userRiskScore: Number(user?.riskScore ?? 0),
      userFlagged: user?.isFlagged === true,
    };
  });
}

async function getTrialHomeSettings() {
  const existing = await AdminPlatformSettings.findOne({ key: 'platform-settings' });
  if (existing) {
    return existing;
  }
  return AdminPlatformSettings.create({ key: 'platform-settings' });
}

function inferApprovalMode(products = []) {
  const hasManual = products.some(
    (product) => product.trialHome?.approvalMode === 'manual',
  );
  return hasManual ? 'manual' : 'auto';
}

function buildWindowStartUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function evaluateEligibility({
  actor,
  payload,
  items,
  productsById,
  settings,
}) {
  const reasons = [];
  const city = actor?.city?.toString().trim().toLowerCase() || '';
  const userTrialScore = Number(actor?.userTrialScore ?? 0);
  const riskScore = Number(actor?.riskScore ?? 0);
  const isFlagged = actor?.isFlagged === true;

  if (settings.trialHomeEnabled === false) {
    reasons.push('Trial at Home is currently disabled by platform controls.');
  }

  if (userTrialScore < Number(settings.trialHomeMinUserScore || 0)) {
    reasons.push('User trial score is below the current eligibility threshold.');
  }

  if (
    settings.trialHomeFraudDetectionEnabled !== false &&
    (isFlagged || riskScore > Number(settings.trialHomeMaxRiskScore || 100))
  ) {
    reasons.push('User risk profile requires manual review before trial approval.');
  }

  const windowStartUtc = buildWindowStartUtc();
  for (const item of items) {
    const product = productsById.get(item.productId);
    if (!product) {
      reasons.push(`Product ${item.productId} is unavailable.`);
      continue;
    }
    if (product.trialHome?.trialEnabled !== true) {
      reasons.push(`${product.name || 'Product'} does not allow Trial at Home.`);
    }
    if (Number(product.stock || 0) <= 0) {
      reasons.push(`${product.name || 'Product'} is out of stock for trial.`);
    }
    const allowedLocations = Array.isArray(product.trialHome?.allowedLocations)
      ? product.trialHome.allowedLocations
          .map((value) => value.toString().trim().toLowerCase())
          .filter(Boolean)
      : [];
    if (allowedLocations.length > 0 && city && !allowedLocations.includes(city)) {
      reasons.push(`${product.name || 'Product'} is not trial-enabled for ${actor.city || 'your area'}.`);
    }
    const trialLimitPerDay = Number(product.trialHome?.trialLimitPerDay || 20);
    const todaysTrials = await TrialHomeSession.countDocuments({
      'items.productId': item.productId,
      createdAt: { $gte: windowStartUtc },
      approvalStatus: { $in: ['pending', 'approved'] },
      status: { $ne: 'cancelled' },
    });
    if (todaysTrials >= trialLimitPerDay) {
      reasons.push(`${product.name || 'Product'} reached today's trial limit.`);
    }
  }

  const mode = inferApprovalMode([...productsById.values()]);
  const autoEligible = reasons.length === 0 && mode === 'auto';

  return {
    reasons,
    mode,
    autoEligible,
    userTrialScore,
  };
}

async function createTrialHomeSession({ userId, payload }) {
  const items = ensureValidItems(payload.items, 'selected');
  const recommendedItems = (Array.isArray(payload.recommendedItems) ? payload.recommendedItems : [])
    .map((item) => normalizeItem(item, 'styled'))
    .filter((item) => item.productId)
    .slice(0, 5);

  const addressLabel = payload.addressLabel?.toString().trim() || '';
  const deliverySlot = payload.deliverySlot?.toString().trim() || '';

  if (!addressLabel || !deliverySlot) {
    const error = new Error('addressLabel and deliverySlot are required.');
    error.statusCode = 400;
    throw error;
  }

  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const session = await TrialHomeSession.create({
    userId,
    items,
    recommendedItems,
    addressLabel,
    deliverySlot,
    deliveryWindowLabel: payload.deliveryWindowLabel?.toString().trim() || 'Delivered in 24 hours',
    experienceType: payload.experienceType === 'standard' ? 'standard' : 'premium',
    trialFee: Number(payload.trialFee || 99),
    trialFeeRefundable: payload.trialFeeRefundable !== false,
    paymentStatus: normalizePaymentStatus(payload.paymentStatus),
    subtotal,
    status: normalizeSessionStatus(payload.status),
    approvalStatus: 'approved',
    approvedBy: 'system',
    approvalReason: 'Legacy book flow auto-approved.',
  });

  pushEvent(session, 'booked', userId, 'Perfect Fit Experience created');
  await session.save();
  return session;
}

async function requestTrialHomeSession({ userId, actor, payload }) {
  const items = ensureValidItems(payload.items, 'selected');
  const recommendedItems = (Array.isArray(payload.recommendedItems)
    ? payload.recommendedItems
    : []
  )
    .map((item) => normalizeItem(item, 'styled'))
    .filter((item) => item.productId)
    .slice(0, 5);

  const addressLabel = payload.addressLabel?.toString().trim() || '';
  const deliverySlot = payload.deliverySlot?.toString().trim() || '';

  if (!addressLabel || !deliverySlot) {
    const error = new Error('addressLabel and deliverySlot are required.');
    error.statusCode = 400;
    throw error;
  }

  const productIds = items.map((item) => item.productId).filter(Boolean);
  const objectIds = productIds.filter((id) => /^[a-f0-9]{24}$/i.test(id));
  const products = await Product.find({ _id: { $in: objectIds } });
  const productsById = new Map(
    products.map((product) => [product._id.toString(), product]),
  );
  const settings = await getTrialHomeSettings();
  const eligibility = await evaluateEligibility({
    actor,
    payload,
    items,
    productsById,
    settings,
  });

  let approvalStatus = 'pending';
  let approvedBy = '';
  let approvalReason = '';
  let status = 'draft';

  if (eligibility.autoEligible) {
    approvalStatus = 'approved';
    approvedBy = 'system';
    approvalReason = 'Auto-approved by eligibility rules.';
    status = 'booked';
  } else if (eligibility.reasons.length > 0) {
    approvalStatus = 'rejected';
    approvedBy = 'system';
    approvalReason = eligibility.reasons.join(' ');
    status = 'cancelled';
  } else {
    approvalStatus = 'pending';
    approvedBy = '';
    approvalReason = 'Waiting for vendor/admin approval.';
    status = 'draft';
  }

  const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  const session = await TrialHomeSession.create({
    userId,
    items,
    recommendedItems,
    addressLabel,
    deliverySlot,
    deliveryWindowLabel:
      payload.deliveryWindowLabel?.toString().trim() || 'Delivered in 24 hours',
    experienceType: payload.experienceType === 'standard' ? 'standard' : 'premium',
    trialFee: Number(payload.trialFee || 99),
    trialFeeRefundable: payload.trialFeeRefundable !== false,
    paymentStatus: normalizePaymentStatus(payload.paymentStatus),
    subtotal,
    status,
    approvalStatus,
    approvedBy,
    approvalReason,
  });

  pushEvent(
    session,
    'request_submitted',
    userId,
    `Trial request submitted (score ${eligibility.userTrialScore.toFixed(0)}).`,
  );
  if (approvalStatus === 'approved') {
    pushEvent(session, 'request_approved', 'system', approvalReason);
  }
  if (approvalStatus === 'rejected') {
    pushEvent(session, 'request_rejected', 'system', approvalReason);
  }
  await session.save();
  return session;
}

async function canActorApproveTrialSession({ session, actor }) {
  if (hasRole(actor, ['admin', 'super_admin'])) {
    return true;
  }
  const storeId = await resolveVendorStoreId(actor);
  const isVendorActor = hasRole(actor, ['vendor']) || Boolean(storeId);
  if (!isVendorActor) {
    return false;
  }
  if (!storeId) {
    return false;
  }
  const productIds = (session.items || [])
    .map((item) => item.productId?.toString().trim())
    .filter(Boolean)
    .filter((id) => /^[a-f0-9]{24}$/i.test(id));
  if (productIds.length === 0) {
    return false;
  }
  const products = await Product.find({ _id: { $in: productIds } });
  return products.every((product) => product.storeId?.toString() === storeId);
}

async function approveTrialHomeRequest({ session, actor, note = '' }) {
  if (session.approvalStatus !== 'pending') {
    const error = new Error('Only pending trial requests can be approved.');
    error.statusCode = 409;
    throw error;
  }
  session.approvalStatus = 'approved';
  const approvedBy = hasRole(actor, ['vendor'])
    ? 'vendor'
    : hasRole(actor, ['admin', 'super_admin'])
    ? 'admin'
    : 'system';
  session.approvedBy =
    approvedBy;
  session.approvalReason = note?.toString().trim() || 'Approved by reviewer.';
  if (session.status === 'draft') {
    session.status = 'booked';
  }
  pushEvent(
    session,
    'request_approved',
    actor?.uid || '',
    session.approvalReason,
  );
  await session.save();
  return session;
}

async function rejectTrialHomeRequest({ session, actor, note = '' }) {
  if (session.approvalStatus !== 'pending') {
    const error = new Error('Only pending trial requests can be rejected.');
    error.statusCode = 409;
    throw error;
  }
  session.approvalStatus = 'rejected';
  const approvedBy = hasRole(actor, ['vendor'])
    ? 'vendor'
    : hasRole(actor, ['admin', 'super_admin'])
    ? 'admin'
    : 'system';
  session.approvedBy =
    approvedBy;
  session.approvalReason = note?.toString().trim() || 'Rejected by reviewer.';
  session.status = 'cancelled';
  pushEvent(
    session,
    'request_rejected',
    actor?.uid || '',
    session.approvalReason,
  );
  await session.save();
  return session;
}

async function listTrialHomeSessionsForVendor({
  actor,
  status,
  approvalStatus,
  includeEnrichedUsers = true,
}) {
  const vendorProductIds = await resolveVendorProductIds(actor);
  if (vendorProductIds.length === 0) {
    return [];
  }
  const query = {
    'items.productId': { $in: vendorProductIds },
  };
  if (status) {
    query.status = status;
  }
  if (approvalStatus) {
    query.approvalStatus = approvalStatus;
  }
  const sessions = await TrialHomeSession.find(query).sort({ createdAt: -1 });
  const productIdSet = new Set(vendorProductIds);
  const vendorOnly = sessions.filter((session) =>
    sessionBelongsToVendor(session, productIdSet),
  );
  return includeEnrichedUsers
    ? enrichSessionsWithUsers(vendorOnly)
    : vendorOnly;
}

async function listTrialHomeProductsForVendor(actor) {
  const storeId = await resolveVendorStoreId(actor);
  if (!storeId) {
    return [];
  }
  const products = await Product.find({ storeId })
    .select('name images category stock trialHome')
    .sort({ updatedAt: -1 });
  return products.map((product) => ({
    id: product._id.toString(),
    name: product.name || 'ABZORA Item',
    imageUrl: Array.isArray(product.images) && product.images.length > 0
      ? product.images[0]
      : '',
    category: product.category || '',
    stock: Number(product.stock || 0),
    trialHome: {
      trialEnabled: Boolean(product.trialHome?.trialEnabled),
      allowedLocations: Array.isArray(product.trialHome?.allowedLocations)
        ? product.trialHome.allowedLocations
        : [],
      trialLimitPerDay: Number(product.trialHome?.trialLimitPerDay || 20),
      trialFee: Number(product.trialHome?.trialFee || 99),
      approvalMode: product.trialHome?.approvalMode || 'auto',
    },
  }));
}

async function updateTrialHomeProductForVendor({
  actor,
  productId,
  payload,
}) {
  if (!/^[a-f0-9]{24}$/i.test(productId)) {
    const error = new Error('Invalid product id.');
    error.statusCode = 400;
    throw error;
  }
  const product = await Product.findById(productId);
  if (!product) {
    const error = new Error('Product not found.');
    error.statusCode = 404;
    throw error;
  }
  const storeId = await resolveVendorStoreId(actor);
  if (!storeId || product.storeId?.toString() !== storeId) {
    const error = new Error('Product access denied for this vendor.');
    error.statusCode = 403;
    throw error;
  }
  const trialHome = payload?.trialHome || payload || {};
  product.trialHome = {
    ...(product.trialHome?.toObject?.() || product.trialHome || {}),
    trialEnabled: Boolean(trialHome.trialEnabled),
    allowedLocations: Array.isArray(trialHome.allowedLocations)
      ? trialHome.allowedLocations
          .map((value) => value?.toString().trim())
          .filter(Boolean)
      : [],
    trialLimitPerDay: Math.max(1, Number(trialHome.trialLimitPerDay || 20)),
    trialFee: Math.max(0, Number(trialHome.trialFee || 99)),
    approvalMode: trialHome.approvalMode === 'manual' ? 'manual' : 'auto',
  };
  await product.save();
  return {
    id: product._id.toString(),
    trialHome: {
      trialEnabled: Boolean(product.trialHome?.trialEnabled),
      allowedLocations: product.trialHome?.allowedLocations || [],
      trialLimitPerDay: Number(product.trialHome?.trialLimitPerDay || 20),
      trialFee: Number(product.trialHome?.trialFee || 99),
      approvalMode: product.trialHome?.approvalMode || 'auto',
    },
  };
}

async function getTrialHomeDashboardForVendor(actor) {
  const sessions = await listTrialHomeSessionsForVendor({
    actor,
    includeEnrichedUsers: true,
  });
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const inWindow = sessions.filter((session) => {
    const createdAt = new Date(session.createdAt || 0);
    return createdAt >= sevenDaysAgo;
  });
  const pendingApprovals = inWindow.filter(
    (session) => session.approvalStatus === 'pending',
  ).length;
  const activeTrials = inWindow.filter((session) =>
    ['booked', 'confirmed', 'out_for_trial_delivery', 'trial_in_progress'].includes(
      session.status,
    ),
  ).length;
  const completed = inWindow.filter((session) => session.status === 'completed');
  const converted = inWindow.filter((session) =>
    ['converted_to_order', 'converted_to_tailoring'].includes(session.status),
  );
  const conversionRate = completed.length === 0
    ? 0
    : (converted.length / completed.length) * 100;
  const revenueFromTrials = inWindow
    .filter((session) => session.status === 'converted_to_order')
    .reduce((sum, session) => sum + Number(session.subtotal || 0), 0);
  const returnedCount = inWindow.reduce(
    (sum, session) => sum + (Array.isArray(session.returnedItems) ? session.returnedItems.length : 0),
    0,
  );
  const keptCount = inWindow.reduce(
    (sum, session) => sum + (Array.isArray(session.keptItems) ? session.keptItems.length : 0),
    0,
  );
  const returnRate = keptCount + returnedCount === 0
    ? 0
    : (returnedCount / (keptCount + returnedCount)) * 100;
  const riskSessions = inWindow.filter((session) =>
    Number(session.userRiskScore || 0) >= 70 || session.userFlagged === true,
  );
  return {
    windowDays: 7,
    activeTrials,
    pendingApprovals,
    conversionRate,
    revenueFromTrials,
    returnRate,
    riskAlerts: riskSessions.length,
    sessionCount: inWindow.length,
  };
}

async function updateTrialHomeSessionForVendor({
  actor,
  sessionId,
  payload,
}) {
  const session = await TrialHomeSession.findById(sessionId);
  if (!session) {
    const error = new Error('Trial-home session not found.');
    error.statusCode = 404;
    throw error;
  }
  const allowed = await canActorApproveTrialSession({
    session,
    actor,
  });
  if (!allowed) {
    const error = new Error('Session access denied for this vendor.');
    error.statusCode = 403;
    throw error;
  }
  const nextStatus = normalizeSessionStatus(payload?.status, session.status);
  session.status = nextStatus;
  if (payload?.paymentStatus) {
    session.paymentStatus = normalizePaymentStatus(
      payload.paymentStatus,
      session.paymentStatus,
    );
  }
  const note = payload?.note?.toString().trim() || 'Vendor status updated.';
  pushEvent(session, 'vendor_status_update', actor?.uid || '', note);
  if (payload?.returnDecision) {
    pushEvent(
      session,
      'return_review',
      actor?.uid || '',
      payload.returnDecision.toString(),
    );
  }
  await session.save();
  const [enriched] = await enrichSessionsWithUsers([session]);
  return enriched || session;
}

async function listTrialHomeSessionsForUser(userId) {
  return TrialHomeSession.find({ userId }).sort({ createdAt: -1 });
}

async function getTrialHomeSessionForUser({ sessionId, userId }) {
  return TrialHomeSession.findOne({ _id: sessionId, userId });
}

async function modifyTrialHomeSession({ session, payload, actorId }) {
  ensureMutableSession(session, 'updated');

  if (payload.items) {
    const items = ensureValidItems(payload.items, 'selected');
    session.items = items;
    session.subtotal = items.reduce((sum, item) => sum + Number(item.price || 0), 0);
  }
  if (payload.addressLabel) {
    session.addressLabel = payload.addressLabel.toString().trim();
  }
  if (payload.deliverySlot) {
    session.deliverySlot = payload.deliverySlot.toString().trim();
  }
  if (payload.experienceType) {
    session.experienceType = payload.experienceType === 'standard' ? 'standard' : 'premium';
  }
  if (payload.paymentStatus) {
    session.paymentStatus = normalizePaymentStatus(payload.paymentStatus, session.paymentStatus);
  }
  session.status = normalizeSessionStatus(payload.status, session.status);
  pushEvent(session, 'modified', actorId, 'Trial-home session updated');
  await session.save();
  return session;
}

async function cancelTrialHomeSession({ session, actorId, note }) {
  ensureMutableSession(session, 'cancelled');
  session.status = 'cancelled';
  pushEvent(session, 'cancelled', actorId, note || 'Cancelled by user');
  await session.save();
  return session;
}

async function submitTrialHomeFeedback({ session, payload, actorId }) {
  if (session.status === 'cancelled') {
    const error = new Error('Cancelled trial-home sessions cannot accept fit feedback.');
    error.statusCode = 409;
    throw error;
  }

  const fit = normalizeFeedbackFit(payload.fit);
  const adjustmentOptions = Array.isArray(payload.adjustmentOptions)
    ? uniqueStrings(payload.adjustmentOptions)
    : [];

  session.feedback = {
    fit,
    note: payload.note?.toString().trim() || '',
    tailoringRecommendation: payload.tailoringRecommendation?.toString().trim() || '',
    adjustmentOptions,
    submittedAt: new Date(),
  };
  session.status = normalizeSessionStatus(payload.status, 'completed');
  pushEvent(session, 'feedback_submitted', actorId, `Fit feedback: ${fit}`);
  await session.save();
  return session;
}

async function convertTrialHomeToOrder({ session, payload, actorId }) {
  if (session.status === 'cancelled') {
    const error = new Error('Cancelled trial-home sessions cannot be converted to orders.');
    error.statusCode = 409;
    throw error;
  }

  session.status = 'converted_to_order';
  session.keptItems = Array.isArray(payload.keptItems) ? uniqueStrings(payload.keptItems) : [];
  session.returnedItems = Array.isArray(payload.returnedItems) ? uniqueStrings(payload.returnedItems) : [];
  session.convertedOrderId = payload.orderId?.toString().trim() || '';
  if (payload.paymentStatus) {
    session.paymentStatus = normalizePaymentStatus(payload.paymentStatus, session.paymentStatus);
  }
  pushEvent(session, 'converted_to_order', actorId, 'Trial-home session converted to order');
  await session.save();
  return session;
}

async function convertTrialHomeToTailoring({ session, payload, actorId }) {
  if (session.status === 'cancelled') {
    const error = new Error('Cancelled trial-home sessions cannot be converted to tailoring.');
    error.statusCode = 409;
    throw error;
  }

  session.status = 'converted_to_tailoring';
  session.tailoringRequest = payload.tailoringRequest?.toString().trim() || '';
  if (payload.targetStoreId || payload.targetStoreName) {
    session.events = Array.isArray(session.events) ? session.events : [];
    session.events.push({
      type: 'atelier_cta_presented',
      actorId,
      note: `Tailor this with ${payload.targetStoreName?.toString().trim() || 'selected atelier'} (${payload.targetStoreId?.toString().trim() || ''})`,
      createdAt: new Date(),
    });
  }
  session.feedback = {
    ...(session.feedback?.toObject?.() || session.feedback || {}),
    tailoringRecommendation:
      payload.tailoringRecommendation?.toString().trim() ||
      session.feedback?.tailoringRecommendation ||
      (payload.targetStoreName
        ? `Tailor this with ${payload.targetStoreName.toString().trim()}`
        : 'Adjust with custom tailoring'),
    adjustmentOptions: Array.isArray(payload.adjustmentOptions)
      ? uniqueStrings(payload.adjustmentOptions)
      : session.feedback?.adjustmentOptions || [],
    submittedAt: session.feedback?.submittedAt || new Date(),
  };
  pushEvent(session, 'converted_to_tailoring', actorId, 'Trial-home session converted to tailoring');
  await session.save();
  return session;
}

module.exports = {
  serializeTrialHomeSession,
  createTrialHomeSession,
  requestTrialHomeSession,
  listTrialHomeSessionsForUser,
  getTrialHomeSessionForUser,
  modifyTrialHomeSession,
  cancelTrialHomeSession,
  submitTrialHomeFeedback,
  convertTrialHomeToOrder,
  convertTrialHomeToTailoring,
  canActorApproveTrialSession,
  approveTrialHomeRequest,
  rejectTrialHomeRequest,
  listTrialHomeSessionsForVendor,
  listTrialHomeProductsForVendor,
  updateTrialHomeProductForVendor,
  getTrialHomeDashboardForVendor,
  updateTrialHomeSessionForVendor,
};
