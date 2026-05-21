const mongoose = require('mongoose');
const { normalizeRole, serializeUser } = require('../middleware/authMiddleware');
const Store = require('../models/Store');
const User = require('../models/User');
const UserAddress = require('../models/UserAddress');
const UserMemory = require('../models/UserMemory');
const UserStyleProfile = require('../models/UserStyleProfile');
const MeasurementProfile = require('../models/MeasurementProfile');
const ReferralRecord = require('../models/ReferralRecord');
const GrowthOffer = require('../models/GrowthOffer');
const VendorKycRequest = require('../models/VendorKycRequest');
const { recordUserNetworkContext } = require('../services/fraudDetectionService');

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin']);
const SELF_ASSIGNABLE_ROLES = new Set(['user', 'customer', 'vendor', 'rider']);
const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected', 'suspended']);

function allowedAdminEmails() {
  return (process.env.ALLOWED_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function allowAdminEmailPromotion() {
  // Security hardening: keep email-based admin elevation disabled unless explicitly enabled.
  return String(process.env.ENABLE_ADMIN_EMAIL_PROMOTION || '').trim().toLowerCase() === 'true';
}

function isAllowedAdminEmail(email) {
  if (!allowAdminEmailPromotion()) {
    return false;
  }
  const normalized = toSafeTrimmedString(email).toLowerCase();
  if (!normalized) {
    return false;
  }
  return allowedAdminEmails().includes(normalized);
}

function toSafeTrimmedString(value) {
  return value == null ? '' : value.toString().trim();
}

function normalizePhoneLike(value) {
  const raw = toSafeTrimmedString(value);
  if (!raw) {
    return '';
  }
  const digitsOrPlus = raw.replace(/[^0-9+]/g, '');
  if (digitsOrPlus.startsWith('+')) {
    return digitsOrPlus;
  }
  return digitsOrPlus;
}

function phoneTail10(value) {
  const normalized = normalizePhoneLike(value).replace(/[^0-9]/g, '');
  if (normalized.length < 10) {
    return '';
  }
  return normalized.slice(-10);
}

function buildPhoneLookupQuery(value) {
  const normalized = normalizePhoneLike(value);
  if (!normalized) {
    return null;
  }
  const tail10 = phoneTail10(normalized);
  return {
    $or: [
      { phone: normalized },
      ...(tail10 ? [{ phone: tail10 }, { phone: new RegExp(`${tail10}$`) }] : []),
    ],
  };
}

async function findBestUserByPhone(phoneValue) {
  const lookup = buildPhoneLookupQuery(phoneValue);
  if (!lookup) {
    return null;
  }
  const matches = await User.find(lookup).sort({ updatedAt: -1, createdAt: -1 });
  if (!matches.length) {
    return null;
  }
  const opsMatch = matches.find((entry) => hasOperationsCapability(entry));
  return opsMatch || matches[0];
}

function normalizeOptionalUrl(value) {
  const normalized = toSafeTrimmedString(value);
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch (_) {
    return '';
  }
}

function clampNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeCoordinate(value, minimum, maximum) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeAddressType(value) {
  const normalized = toSafeTrimmedString(value).toLowerCase();
  return ['home', 'work', 'other'].includes(normalized) ? normalized : 'home';
}

function sanitizeRoles(input, fallbackRole) {
  const candidate = input && typeof input === 'object' ? input : {};
  const roles = {};
  for (const [key, value] of Object.entries(candidate)) {
    const normalizedKey = normalizeRole(key, '');
    if (!normalizedKey || PRIVILEGED_ROLES.has(normalizedKey)) {
      continue;
    }
    roles[normalizedKey] = Boolean(value);
  }
  if (fallbackRole && SELF_ASSIGNABLE_ROLES.has(fallbackRole)) {
    roles[fallbackRole] = true;
  }
  return roles;
}

function hasOperationsCapability(user) {
  if (!user) {
    return false;
  }
  const role = normalizeRole(user.role, '');
  if (role === 'vendor' || role === 'rider') {
    return true;
  }
  const roles =
    user.roles instanceof Map
      ? Object.fromEntries(user.roles.entries())
      : { ...(user.roles || {}) };
  if (Boolean(roles.vendor) || Boolean(roles.rider)) {
    return true;
  }
  if (toSafeTrimmedString(user.storeId)) {
    return true;
  }
  return toSafeTrimmedString(user.riderApprovalStatus).toLowerCase() === 'approved';
}

function serializeUserResponse(user) {
  return {
    id: user?._id?.toString?.() || null,
    ...serializeUser(user),
  };
}

function buildUserLookupQuery(identifier) {
  const normalized = identifier?.toString().trim() || '';
  if (!normalized) {
    return null;
  }

  const orConditions = [
    { firebaseUid: normalized },
    { uid: normalized },
  ];
  if (mongoose.Types.ObjectId.isValid(normalized)) {
    orConditions.push({ _id: normalized });
  }
  return { $or: orConditions };
}

function serializeMeasurementProfile(profile) {
  return {
    id: profile?._id?.toString?.() || '',
    userId: profile?.userId || '',
    label: profile?.label || '',
    method: profile?.method || 'manual',
    unit: profile?.unit || 'cm',
    chest: Number(profile?.chest || 0),
    shoulder: Number(profile?.shoulder || 0),
    waist: Number(profile?.waist || 0),
    sleeve: Number(profile?.sleeve || 0),
    length: Number(profile?.length || 0),
    standardSize: profile?.standardSize || '',
    recommendedSize: profile?.recommendedSize || '',
    sourceProfileId: profile?.sourceProfileId || '',
  };
}

function serializeReferralRecord(record) {
  return {
    id: record?._id?.toString?.() || '',
    referrerId: record?.referrerId || '',
    referredUserId: record?.referredUserId || '',
    referralCode: record?.referralCode || '',
    status: record?.status || 'pending',
    rewardGiven: Boolean(record?.rewardGiven),
    referrerReward: Number(record?.referrerReward || 0),
    friendReward: Number(record?.friendReward || 0),
    createdAt: record?.createdAtIso || record?.createdAt?.toISOString?.() || '',
    completedAt: record?.completedAt || '',
    qualifyingOrderId: record?.qualifyingOrderId || '',
    qualifyingOrderAmount:
      record?.qualifyingOrderAmount == null ? null : Number(record.qualifyingOrderAmount),
    fraudFlags: Array.isArray(record?.fraudFlags) ? record.fraudFlags : [],
  };
}

function serializeGrowthOffer(offer) {
  return {
    id: offer?._id?.toString?.() || '',
    userId: offer?.userId || '',
    type: offer?.type || 'discount',
    title: offer?.title || '',
    subtitle: offer?.subtitle || '',
    code: offer?.code || '',
    discountPercent: Number(offer?.discountPercent || 0),
    discountAmount: Number(offer?.discountAmount || 0),
    minOrderValue: Number(offer?.minOrderValue || 0),
    autoApply: Boolean(offer?.autoApply),
    isClaimed: Boolean(offer?.isClaimed),
    createdAt: offer?.createdAtIso || offer?.createdAt?.toISOString?.() || '',
    expiresAt: offer?.expiresAt || '',
    metadata: offer?.metadata && typeof offer.metadata === 'object' ? offer.metadata : {},
  };
}

function serializeAddress(address) {
  return {
    id: address?.addressId || '',
    userId: address?.userId || '',
    name: address?.name || '',
    phone: address?.phone || '',
    addressLine: address?.addressLine || '',
    city: address?.city || '',
    state: address?.state || '',
    pincode: address?.pincode || '',
    houseDetails: address?.houseDetails || '',
    landmark: address?.landmark || '',
    locality: address?.locality || '',
    latitude: address?.latitude ?? null,
    longitude: address?.longitude ?? null,
    type: address?.type || 'home',
    createdAt: address?.createdAtIso || address?.createdAt?.toISOString?.() || '',
  };
}

function serializeUserMemory(memory, userId) {
  return {
    userId,
    name: memory?.name || '',
    preferredStyle: memory?.preferredStyle || '',
    size: memory?.size || '',
    heightCm: memory?.heightCm ?? null,
    weightKg: memory?.weightKg ?? null,
    bodyType: memory?.bodyType || '',
    recommendedSize: memory?.recommendedSize || memory?.size || '',
    pantSize: memory?.pantSize || '',
    fitPreference: memory?.fitPreference || 'regular',
    shoulderCm: memory?.shoulderCm ?? null,
    chestCm: memory?.chestCm ?? null,
    waistCm: memory?.waistCm ?? null,
    hipCm: memory?.hipCm ?? null,
    armLengthCm: memory?.armLengthCm ?? null,
    inseamCm: memory?.inseamCm ?? null,
    confidence: memory?.confidence ?? null,
    scanFrameCount: memory?.scanFrameCount ?? null,
    scanSource: memory?.scanSource || '',
    pastIssues: Array.isArray(memory?.pastIssues) ? memory.pastIssues : [],
    lastOrderId: memory?.lastOrderId || '',
    lastConversationSummary: memory?.lastConversationSummary || '',
    cartItems: Array.isArray(memory?.cartItems) ? memory.cartItems : [],
    cartUpdatedAt: memory?.cartUpdatedAtIso || '',
    updatedAt: memory?.updatedAtIso || memory?.updatedAt?.toISOString?.() || '',
  };
}

function serializeBodyProfile(memory) {
  if (!memory) {
    return null;
  }
  return {
    height: memory?.heightCm ?? null,
    heightCm: memory?.heightCm ?? null,
    chest: memory?.chestCm ?? null,
    chestCm: memory?.chestCm ?? null,
    waist: memory?.waistCm ?? null,
    waistCm: memory?.waistCm ?? null,
    hips: memory?.hipCm ?? null,
    hipCm: memory?.hipCm ?? null,
    shoulder: memory?.shoulderCm ?? null,
    shoulderCm: memory?.shoulderCm ?? null,
    armLengthCm: memory?.armLengthCm ?? null,
    inseamCm: memory?.inseamCm ?? null,
    fitPreference: memory?.fitPreference || 'regular',
    confidence: memory?.confidence ?? null,
    scanFrameCount: memory?.scanFrameCount ?? null,
    updatedAt: memory?.updatedAtIso || memory?.updatedAt?.toISOString?.() || '',
  };
}

function normalizeCartItems(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ...item,
      productId: toSafeTrimmedString(item.productId),
      size: toSafeTrimmedString(item.size),
      quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      product:
        item.product && typeof item.product === 'object'
          ? { ...item.product }
          : {},
    }))
    .filter((item) => item.productId);
}

function buildReferralCode(user) {
  const seed = `${(user?.phone || user?.uid || user?._id?.toString?.() || 'Abianzo')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()}ABZ`;
  // Security/reliability hardening: JS has padEnd, not padRight.
  // Using padEnd avoids runtime failure that can break referral issuance paths.
  return seed.length > 10 ? seed.substring(0, 10) : seed.padEnd(8, 'X');
}

async function ensureReferralCodeForUser(user) {
  if (!user) {
    return '';
  }
  const existing = toSafeTrimmedString(user.referralCode).toUpperCase();
  if (existing) {
    return existing;
  }
  user.referralCode = buildReferralCode(user);
  await user.save();
  return user.referralCode;
}

function referralTierForCompletedInvites(completedInvites) {
  if (completedInvites >= 10) {
    return 'Gold';
  }
  if (completedInvites >= 4) {
    return 'Silver';
  }
  return 'Bronze';
}

function invitesToNextReferralTier(completedInvites) {
  if (completedInvites < 4) {
    return 4 - completedInvites;
  }
  if (completedInvites < 10) {
    return 10 - completedInvites;
  }
  return 0;
}

function referralProgress(completedInvites) {
  if (completedInvites >= 10) {
    return 1;
  }
  if (completedInvites >= 4) {
    return (completedInvites - 4) / 6;
  }
  return completedInvites / 4;
}

async function findApprovedVendorKyc(user) {
  if (!user) {
    return null;
  }

  return VendorKycRequest.findOne({
    status: 'approved',
    $or: [
      ...(user.firebaseUid ? [{ userId: user.firebaseUid }] : []),
      ...(user.uid ? [{ userId: user.uid }] : []),
      ...(user.phone ? [{ phone: user.phone }] : []),
    ],
  }).sort({ updatedAt: -1, _id: -1 });
}

async function ensureLinkedStoreId(user) {
  if (!user) {
    return user;
  }

  const approvedVendorKyc = await findApprovedVendorKyc(user);
  const shouldPromoteVendor =
    user.role === 'vendor' ||
    Boolean(approvedVendorKyc);

  if (!shouldPromoteVendor) {
    return user;
  }

  const currentRoles =
    user.roles instanceof Map
      ? Object.fromEntries(user.roles.entries())
      : { ...(user.roles || {}) };

  let needsSave = false;
  if (user.role !== 'vendor') {
    user.role = 'vendor';
    needsSave = true;
  }
  if (!user.isActive) {
    user.isActive = true;
    needsSave = true;
  }
  if (!currentRoles.vendor) {
    currentRoles.vendor = true;
    user.roles = currentRoles;
    needsSave = true;
  }

  let linkedStore = await Store.findOne({
    $or: [
      ...(user._id ? [{ vendorId: user._id }] : []),
      ...(user.firebaseUid ? [{ ownerId: user.firebaseUid }] : []),
      ...(user.uid ? [{ ownerId: user.uid }] : []),
      ...((user.storeId || '').trim().length > 0 && mongoose.Types.ObjectId.isValid(user.storeId)
        ? [{ _id: user.storeId }]
        : []),
    ],
  }).sort({ createdAt: -1 });

  if (!linkedStore && approvedVendorKyc) {
    linkedStore = await Store.create({
      vendorId: user._id,
      ownerId: user.firebaseUid || user.uid || user._id.toString(),
      name:
        toSafeTrimmedString(approvedVendorKyc.storeName) ||
        toSafeTrimmedString(approvedVendorKyc.ownerName) ||
        toSafeTrimmedString(user.name) ||
        'My Store',
      description: toSafeTrimmedString(approvedVendorKyc.address),
      isActive: true,
    });
    needsSave = true;
  }

  if (linkedStore) {
    if (!linkedStore.vendorId && user._id) {
      linkedStore.vendorId = user._id;
      await linkedStore.save();
    }
    if ((user.storeId || '').trim() !== linkedStore._id.toString()) {
      user.storeId = linkedStore._id.toString();
      needsSave = true;
    }
  }

  if (needsSave) {
    await user.save();
  }

  return user;
}

async function me(req, res, next) {
  try {
    let user = req.dbUser;
    if (user && req.user?.emailVerified === true && isAllowedAdminEmail(req.user?.email || user.email)) {
      if (!PRIVILEGED_ROLES.has(user.role)) {
        user.role = 'admin';
      }
      const nextRoles =
        user.roles instanceof Map
          ? Object.fromEntries(user.roles.entries())
          : { ...(user.roles || {}) };
      nextRoles.admin = true;
      user.roles = nextRoles;
      user.email = toSafeTrimmedString(req.user?.email) || user.email;
      await user.save();
      req.user = {
        ...req.user,
        ...serializeUser(user),
        _id: user._id,
      };
    }

    if (user && !hasOperationsCapability(user)) {
      const phoneCandidates = [
        toSafeTrimmedString(req.user?.phone),
        toSafeTrimmedString(user.phone),
      ].filter(Boolean);

      for (const candidatePhone of phoneCandidates) {
        const byPhone = await findBestUserByPhone(candidatePhone);
        if (!byPhone) {
          continue;
        }
        if (!hasOperationsCapability(byPhone)) {
          continue;
        }
        const currentUid = toSafeTrimmedString(req.user?.uid);
        if (currentUid) {
          byPhone.firebaseUid = currentUid;
          byPhone.uid = currentUid;
        }
        await byPhone.save();
        user = byPhone;
        req.dbUser = byPhone;
        req.user = {
          ...req.user,
          ...serializeUser(byPhone),
          _id: byPhone._id,
        };
        break;
      }
    }

    user = await ensureLinkedStoreId(user);
    if (user) {
      req.user = {
        ...req.user,
        ...serializeUser(user),
        _id: user._id,
      };
    }

  return res.status(200).json({
    success: true,
    data: serializeUserResponse(user || req.user),
  });
  } catch (error) {
    return next(error);
  }
}

async function getUserByIdentifier(req, res, next) {
  try {
    const identifier = req.params.id?.toString().trim() || '';
    const lookup = buildUserLookupQuery(identifier);
    if (!lookup) {
      return res.status(400).json({
        success: false,
        message: 'User identifier is required.',
      });
    }

    const user = await User.findOne(lookup);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.',
      });
    }

    const hydratedUser = await ensureLinkedStoreId(user);
    return res.status(200).json({
      success: true,
      data: serializeUserResponse(hydratedUser),
    });
  } catch (error) {
    return next(error);
  }
}

function debugAuth(req, res) {
  return res.status(200).json({
    success: true,
    data: {
      mode: 'firebase',
      user: {
        id: req.user._id || null,
        uid: req.user.uid,
        role: req.user.role || null,
        phone: req.user.phone || null,
        name: req.user.name || null,
        storeId: req.user.storeId || null,
        riderApprovalStatus: req.user.riderApprovalStatus || null,
      },
    },
  });
}

function normalizePhone(value) {
  return value == null ? '' : value.toString().trim();
}

async function upsertTestUser(req, res, next) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ success: false, message: 'Route not found.' });
    }
    if (process.env.ENABLE_TEST_AUTH_ROUTES !== 'true') {
      return res.status(403).json({
        success: false,
        message: 'Test auth routes are disabled.',
      });
    }
    const phone = normalizePhone(req.body?.phone);
    if (!phone) {
      return res.status(400).json({
        success: false,
        message: 'phone is required.',
      });
    }

    let user = await User.findOne({ phone });
    if (!user) {
      const syntheticUid = `phone:${phone}`;
      user = await User.create({
        firebaseUid: syntheticUid,
        uid: syntheticUid,
        phone,
        role: 'customer',
        roles: { customer: true },
        name: 'Abianzo Member',
      });
    }

    return res.status(200).json({
      success: true,
      data: serializeUserResponse(user),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function syncProfile(req, res, next) {
  try {
    if (!req.dbUser) {
      return res.status(400).json({
        success: false,
        message: 'Profile sync is unavailable in test mode.',
      });
    }

    req.dbUser.name = toSafeTrimmedString(req.body?.name) || req.dbUser.name || 'Abianzo Member';
    req.dbUser.phone = toSafeTrimmedString(req.body?.phone) || req.dbUser.phone;
    req.dbUser.email = toSafeTrimmedString(req.body?.email) || req.dbUser.email;

    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'profileImageUrl')) {
      const nextProfileImageUrl = normalizeOptionalUrl(req.body?.profileImageUrl);
      if (toSafeTrimmedString(req.body?.profileImageUrl) && !nextProfileImageUrl) {
        return res.status(400).json({
          success: false,
          message: 'profileImageUrl must be a valid http/https URL.',
        });
      }
      req.dbUser.profileImageUrl = nextProfileImageUrl;
    }

    req.dbUser.address = toSafeTrimmedString(req.body?.address);
    req.dbUser.area = toSafeTrimmedString(req.body?.area);
    req.dbUser.city = toSafeTrimmedString(req.body?.city);
    req.dbUser.latitude = normalizeCoordinate(req.body?.latitude, -90, 90);
    req.dbUser.longitude = normalizeCoordinate(req.body?.longitude, -180, 180);
    req.dbUser.deliveryRadiusKm = req.body?.deliveryRadiusKm == null
      ? req.dbUser.deliveryRadiusKm || 10
      : clampNumber(req.body.deliveryRadiusKm, req.dbUser.deliveryRadiusKm || 10, 1, 100);
    req.dbUser.locationUpdatedAt = new Date().toISOString();
    req.dbUser.lastLoginAt = new Date();

    await req.dbUser.save();

    // If this session lands on a stale non-ops profile but the submitted phone
    // maps to a vendor/rider account, switch the Firebase UID binding to that
    // operations-capable profile.
    let effectiveUser = req.dbUser;
    if (!hasOperationsCapability(effectiveUser)) {
      const candidatePhone = toSafeTrimmedString(req.body?.phone) || toSafeTrimmedString(effectiveUser.phone);
      if (candidatePhone) {
        const byPhone = await findBestUserByPhone(candidatePhone);
        if (byPhone && hasOperationsCapability(byPhone) && String(byPhone._id) !== String(effectiveUser._id)) {
          const currentUid = toSafeTrimmedString(req.user?.uid);
          if (currentUid) {
            byPhone.firebaseUid = currentUid;
            byPhone.uid = currentUid;
          }
          await byPhone.save();
          effectiveUser = byPhone;
          req.dbUser = byPhone;
        }
      }
    }

    effectiveUser = await ensureLinkedStoreId(effectiveUser);
    await recordUserNetworkContext(effectiveUser, req);

    req.user = {
      ...req.user,
      ...serializeUser(effectiveUser),
      _id: effectiveUser._id,
    };

    return res.status(200).json({
      success: true,
      data: serializeUserResponse(effectiveUser),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listAddresses(req, res, next) {
  try {
    const addresses = await UserAddress.find({ userId: req.user.uid }).sort({ createdAt: -1, _id: -1 });
    return res.status(200).json({
      success: true,
      data: addresses.map((item) => serializeAddress(item)),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveAddress(req, res, next) {
  try {
    const addressId = toSafeTrimmedString(req.body?.id) || `addr-${Date.now()}`;
    const createdAtIso = toSafeTrimmedString(req.body?.createdAt) || new Date().toISOString();
    const address = await UserAddress.findOneAndUpdate(
      {
        addressId,
        userId: req.user.uid,
      },
      {
        addressId,
        userId: req.user.uid,
        name: toSafeTrimmedString(req.body?.name),
        phone: toSafeTrimmedString(req.body?.phone),
        addressLine: toSafeTrimmedString(req.body?.addressLine),
        city: toSafeTrimmedString(req.body?.city),
        state: toSafeTrimmedString(req.body?.state),
        pincode: toSafeTrimmedString(req.body?.pincode),
        houseDetails: toSafeTrimmedString(req.body?.houseDetails),
        landmark: toSafeTrimmedString(req.body?.landmark),
        locality: toSafeTrimmedString(req.body?.locality),
        latitude: normalizeCoordinate(req.body?.latitude, -90, 90),
        longitude: normalizeCoordinate(req.body?.longitude, -180, 180),
        type: normalizeAddressType(req.body?.type),
        createdAtIso,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      data: serializeAddress(address),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function deleteAddress(req, res, next) {
  try {
    const addressId = toSafeTrimmedString(req.params.id);
    if (!addressId) {
      return res.status(400).json({ success: false, message: 'Address id is required.' });
    }

    await UserAddress.deleteOne({ addressId, userId: req.user.uid });
    return res.status(200).json({
      success: true,
      data: { deleted: true, id: addressId },
    });
  } catch (error) {
    return next(error);
  }
}

async function getMemory(req, res, next) {
  try {
    const memory = await UserMemory.findOne({ userId: req.user.uid });
    return res.status(200).json({
      success: true,
      data: memory ? serializeUserMemory(memory, req.user.uid) : null,
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMemory(req, res, next) {
  try {
    const existingMemory = await UserMemory.findOne({ userId: req.user.uid });
    const has = (key) => Object.prototype.hasOwnProperty.call(req.body || {}, key);
    const nowIso = new Date().toISOString();
    const memory = await UserMemory.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        name: has('name') ? toSafeTrimmedString(req.body?.name) : existingMemory?.name || '',
        preferredStyle: has('preferredStyle')
          ? toSafeTrimmedString(req.body?.preferredStyle)
          : existingMemory?.preferredStyle || '',
        size: has('size') ? toSafeTrimmedString(req.body?.size) : existingMemory?.size || '',
        heightCm: has('heightCm')
          ? normalizeCoordinate(req.body?.heightCm, 50, 300)
          : existingMemory?.heightCm ?? null,
        weightKg: has('weightKg')
          ? normalizeCoordinate(req.body?.weightKg, 10, 500)
          : existingMemory?.weightKg ?? null,
        bodyType: has('bodyType')
          ? toSafeTrimmedString(req.body?.bodyType)
          : existingMemory?.bodyType || '',
        recommendedSize: has('recommendedSize') || has('size')
          ? (toSafeTrimmedString(req.body?.recommendedSize) || toSafeTrimmedString(req.body?.size))
          : existingMemory?.recommendedSize || existingMemory?.size || '',
        pantSize: has('pantSize') ? toSafeTrimmedString(req.body?.pantSize) : existingMemory?.pantSize || '',
        fitPreference: has('fitPreference')
          ? toSafeTrimmedString(req.body?.fitPreference) || 'regular'
          : existingMemory?.fitPreference || 'regular',
        shoulderCm: has('shoulderCm')
          ? normalizeCoordinate(req.body?.shoulderCm, 10, 200)
          : existingMemory?.shoulderCm ?? null,
        chestCm: has('chestCm')
          ? normalizeCoordinate(req.body?.chestCm, 20, 300)
          : existingMemory?.chestCm ?? null,
        waistCm: has('waistCm')
          ? normalizeCoordinate(req.body?.waistCm, 20, 300)
          : existingMemory?.waistCm ?? null,
        hipCm: has('hipCm')
          ? normalizeCoordinate(req.body?.hipCm, 20, 300)
          : existingMemory?.hipCm ?? null,
        armLengthCm: has('armLengthCm')
          ? normalizeCoordinate(req.body?.armLengthCm, 10, 150)
          : existingMemory?.armLengthCm ?? null,
        inseamCm: has('inseamCm')
          ? normalizeCoordinate(req.body?.inseamCm, 10, 150)
          : existingMemory?.inseamCm ?? null,
        confidence: has('confidence')
          ? normalizeCoordinate(req.body?.confidence, 0, 1)
          : existingMemory?.confidence ?? null,
        scanFrameCount: has('scanFrameCount')
          ? normalizeCoordinate(req.body?.scanFrameCount, 0, 100000)
          : existingMemory?.scanFrameCount ?? null,
        scanSource: has('scanSource')
          ? toSafeTrimmedString(req.body?.scanSource)
          : existingMemory?.scanSource || '',
        pastIssues: has('pastIssues')
          ? (Array.isArray(req.body?.pastIssues)
              ? req.body.pastIssues.map((item) => item?.toString?.().trim?.() || '').filter(Boolean)
              : [])
          : (Array.isArray(existingMemory?.pastIssues) ? existingMemory.pastIssues : []),
        lastOrderId: has('lastOrderId')
          ? toSafeTrimmedString(req.body?.lastOrderId)
          : existingMemory?.lastOrderId || '',
        lastConversationSummary: has('lastConversationSummary')
          ? toSafeTrimmedString(req.body?.lastConversationSummary)
          : existingMemory?.lastConversationSummary || '',
        cartItems: has('cartItems')
          ? normalizeCartItems(req.body?.cartItems)
          : (Array.isArray(existingMemory?.cartItems) ? existingMemory.cartItems : []),
        cartUpdatedAtIso: has('cartItems') || has('cartUpdatedAt')
          ? (toSafeTrimmedString(req.body?.cartUpdatedAt) || nowIso)
          : existingMemory?.cartUpdatedAtIso || '',
        updatedAtIso: toSafeTrimmedString(req.body?.updatedAt) || nowIso,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await UserStyleProfile.findOneAndUpdate(
      { userId: req.user.uid },
      {
        userId: req.user.uid,
        bodyType: toSafeTrimmedString(req.body?.bodyType),
        size:
          toSafeTrimmedString(req.body?.recommendedSize) ||
          toSafeTrimmedString(req.body?.size),
        updatedAtIso: toSafeTrimmedString(req.body?.updatedAt) || new Date().toISOString(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      success: true,
      data: serializeUserMemory(memory, req.user.uid),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function getBodyProfile(req, res, next) {
  try {
    const memory = await UserMemory.findOne({ userId: req.user.uid });
    return res.status(200).json({
      success: true,
      data: serializeBodyProfile(memory),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveBodyProfile(req, res, next) {
  try {
    const nowIso = new Date().toISOString();
    const payload = {
      userId: req.user.uid,
      heightCm:
        req.body?.heightCm == null && req.body?.height == null
          ? null
          : normalizeCoordinate(req.body?.heightCm ?? req.body?.height, 50, 300),
      bodyType: toSafeTrimmedString(req.body?.bodyType),
      recommendedSize:
        toSafeTrimmedString(req.body?.recommendedSize) ||
        toSafeTrimmedString(req.body?.size),
      pantSize: toSafeTrimmedString(req.body?.pantSize),
      fitPreference: toSafeTrimmedString(req.body?.fitPreference) || 'regular',
      shoulderCm:
        req.body?.shoulderCm == null && req.body?.shoulder == null
          ? null
          : normalizeCoordinate(req.body?.shoulderCm ?? req.body?.shoulder, 10, 200),
      chestCm:
        req.body?.chestCm == null && req.body?.chest == null
          ? null
          : normalizeCoordinate(req.body?.chestCm ?? req.body?.chest, 20, 300),
      waistCm:
        req.body?.waistCm == null && req.body?.waist == null
          ? null
          : normalizeCoordinate(req.body?.waistCm ?? req.body?.waist, 20, 300),
      hipCm:
        req.body?.hipCm == null && req.body?.hips == null && req.body?.hip == null
          ? null
          : normalizeCoordinate(req.body?.hipCm ?? req.body?.hips ?? req.body?.hip, 20, 300),
      armLengthCm:
        req.body?.armLengthCm == null ? null : normalizeCoordinate(req.body?.armLengthCm, 10, 150),
      inseamCm: req.body?.inseamCm == null ? null : normalizeCoordinate(req.body?.inseamCm, 10, 150),
      confidence:
        req.body?.confidence == null ? null : normalizeCoordinate(req.body?.confidence, 0, 1),
      scanFrameCount:
        req.body?.scanFrameCount == null ? null : normalizeCoordinate(req.body?.scanFrameCount, 0, 100000),
      scanSource: toSafeTrimmedString(req.body?.scanSource),
      updatedAtIso: toSafeTrimmedString(req.body?.updatedAt) || nowIso,
    };
    const memory = await UserMemory.findOneAndUpdate(
      { userId: req.user.uid },
      payload,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.status(200).json({
      success: true,
      data: serializeBodyProfile(memory),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listMeasurementProfiles(req, res, next) {
  try {
    const profiles = await MeasurementProfile.find({ userId: req.user.uid }).sort({
      updatedAt: -1,
      _id: -1,
    });
    return res.status(200).json({
      success: true,
      data: profiles.map(serializeMeasurementProfile),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveMeasurementProfile(req, res, next) {
  try {
    const profileId = toSafeTrimmedString(req.body?.id);
    const payload = {
      userId: req.user.uid,
      label: toSafeTrimmedString(req.body?.label) || 'Saved Fit',
      method: toSafeTrimmedString(req.body?.method) || 'manual',
      unit: toSafeTrimmedString(req.body?.unit) || 'cm',
      chest: clampNumber(req.body?.chest, 0, 0, 300),
      shoulder: clampNumber(req.body?.shoulder, 0, 0, 200),
      waist: clampNumber(req.body?.waist, 0, 0, 300),
      sleeve: clampNumber(req.body?.sleeve, 0, 0, 150),
      length: clampNumber(req.body?.length, 0, 0, 300),
      standardSize: toSafeTrimmedString(req.body?.standardSize),
      recommendedSize: toSafeTrimmedString(req.body?.recommendedSize),
      sourceProfileId: toSafeTrimmedString(req.body?.sourceProfileId),
    };

    let profile;
    if (profileId && mongoose.Types.ObjectId.isValid(profileId)) {
      profile = await MeasurementProfile.findOneAndUpdate(
        { _id: profileId, userId: req.user.uid },
        payload,
        { new: true }
      );
    }
    if (!profile) {
      profile = await MeasurementProfile.create(payload);
    }

    return res.status(200).json({
      success: true,
      data: serializeMeasurementProfile(profile),
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function removeMeasurementProfile(req, res, next) {
  try {
    const profileId = toSafeTrimmedString(req.params?.id);
    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      return res.status(404).json({ success: false, message: 'Measurement profile not found.' });
    }
    await MeasurementProfile.deleteOne({ _id: profileId, userId: req.user.uid });
    return res.status(200).json({ success: true, data: true });
  } catch (error) {
    return next(error);
  }
}

async function applyReferralCode(req, res, next) {
  try {
    const actor = req.dbUser || (await User.findOne({ uid: req.user.uid }));
    const normalized = toSafeTrimmedString(req.body?.code).toUpperCase();
    if (!actor) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (!normalized) {
      return res.status(400).json({ success: false, message: 'Enter a valid referral code.' });
    }
    if (toSafeTrimmedString(actor.referredBy)) {
      return res.status(400).json({ success: false, message: 'A referral code has already been applied to this account.' });
    }

    const referrer = await User.findOne({ referralCode: normalized });
    if (!referrer) {
      return res.status(404).json({ success: false, message: 'This referral code could not be found.' });
    }
    if ((referrer.uid || referrer.firebaseUid) === req.user.uid) {
      return res.status(400).json({ success: false, message: 'You cannot use your own referral code.' });
    }
    if (toSafeTrimmedString(referrer.phone) && toSafeTrimmedString(referrer.phone) === toSafeTrimmedString(actor.phone)) {
      return res.status(400).json({ success: false, message: 'This referral cannot be applied to the same phone number.' });
    }

    const existing = await ReferralRecord.findOne({
      referrerId: referrer.uid || referrer.firebaseUid,
      referredUserId: req.user.uid,
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'This referral has already been linked.' });
    }

    const record = await ReferralRecord.create({
      referrerId: referrer.uid || referrer.firebaseUid,
      referredUserId: req.user.uid,
      referralCode: normalized,
      status: 'pending',
      createdAtIso: new Date().toISOString(),
    });
    actor.referredBy = referrer.uid || referrer.firebaseUid;
    await actor.save();

    return res.status(200).json({
      success: true,
      data: serializeReferralRecord(record),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: 'This referral has already been linked.' });
    }
    return next(error);
  }
}

async function listReferralHistory(req, res, next) {
  try {
    const history = await ReferralRecord.find({ referrerId: req.user.uid }).sort({
      createdAt: -1,
      _id: -1,
    });
    return res.status(200).json({
      success: true,
      data: history.map(serializeReferralRecord),
    });
  } catch (error) {
    return next(error);
  }
}

async function getReferralDashboard(req, res, next) {
  try {
    const user = req.dbUser || (await User.findOne({ uid: req.user.uid }));
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const referralCode = await ensureReferralCodeForUser(user);
    const history = await ReferralRecord.find({ referrerId: req.user.uid }).sort({
      createdAt: -1,
      _id: -1,
    });
    const completed = history.filter((item) => item.rewardGiven);
    const pending = history.filter((item) => !item.rewardGiven);
    const completedCount = completed.length;
    return res.status(200).json({
      success: true,
      data: {
        referralCode,
        invitedCount: history.length,
        completedCount,
        pendingCount: pending.length,
        earnedCredits: completed.reduce((sum, item) => sum + Number(item.referrerReward || 0), 0),
        walletBalance: Number(user.walletBalance || 0),
        tier: referralTierForCompletedInvites(completedCount),
        nextTierProgress: referralProgress(completedCount),
        invitesToNextTier: invitesToNextReferralTier(completedCount),
        history: history.map(serializeReferralRecord),
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function listGrowthOffers(req, res, next) {
  try {
    const offers = await GrowthOffer.find({ userId: req.user.uid }).sort({
      createdAt: -1,
      _id: -1,
    });
    return res.status(200).json({
      success: true,
      data: offers.map(serializeGrowthOffer),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveGrowthOffer(req, res, next) {
  try {
    const offerId = toSafeTrimmedString(req.body?.id);
    const payload = {
      userId: req.user.uid,
      type: toSafeTrimmedString(req.body?.type) || 'discount',
      title: toSafeTrimmedString(req.body?.title),
      subtitle: toSafeTrimmedString(req.body?.subtitle),
      code: toSafeTrimmedString(req.body?.code).toUpperCase(),
      discountPercent: Number(req.body?.discountPercent || 0),
      discountAmount: Number(req.body?.discountAmount || 0),
      minOrderValue: Number(req.body?.minOrderValue || 0),
      autoApply: Boolean(req.body?.autoApply),
      isClaimed: Boolean(req.body?.isClaimed),
      createdAtIso: toSafeTrimmedString(req.body?.createdAt) || new Date().toISOString(),
      expiresAt: toSafeTrimmedString(req.body?.expiresAt),
      metadata: req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {},
    };
    if (!payload.code) {
      return res.status(400).json({ success: false, message: 'Offer code is required.' });
    }
    let offer;
    if (offerId && mongoose.Types.ObjectId.isValid(offerId)) {
      offer = await GrowthOffer.findOneAndUpdate(
        { _id: offerId, userId: req.user.uid },
        payload,
        { new: true }
      );
    }
    if (!offer) {
      offer = await GrowthOffer.findOneAndUpdate(
        { userId: req.user.uid, code: payload.code },
        payload,
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
    }
    return res.status(200).json({ success: true, data: serializeGrowthOffer(offer) });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ success: false, message: 'That offer code already exists.' });
    }
    return next(error);
  }
}

async function validateGrowthOffer(req, res, next) {
  try {
    const code = toSafeTrimmedString(req.body?.code).toUpperCase();
    const cartValue = Number(req.body?.cartValue || 0);
    if (!code) {
      return res.status(200).json({ success: true, data: null });
    }
    const offer = await GrowthOffer.findOne({ userId: req.user.uid, code });
    if (!offer) {
      return res.status(200).json({ success: true, data: null });
    }
    const expired = offer.expiresAt && Date.parse(offer.expiresAt) < Date.now();
    const eligible = !offer.isClaimed && !expired && cartValue >= Number(offer.minOrderValue || 0);
    return res.status(200).json({
      success: true,
      data: eligible ? serializeGrowthOffer(offer) : null,
    });
  } catch (error) {
    return next(error);
  }
}

async function claimGrowthOffer(req, res, next) {
  try {
    const code = toSafeTrimmedString(req.body?.code).toUpperCase() || toSafeTrimmedString(req.params?.code).toUpperCase();
    if (!code) {
      return res.status(400).json({ success: false, message: 'Offer code is required.' });
    }
    const offer = await GrowthOffer.findOneAndUpdate(
      { userId: req.user.uid, code },
      { isClaimed: true },
      { new: true }
    );
    return res.status(200).json({
      success: true,
      data: offer ? serializeGrowthOffer(offer) : null,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  me,
  getUserByIdentifier,
  debugAuth,
  upsertTestUser,
  syncProfile,
  listAddresses,
  saveAddress,
  deleteAddress,
  getMemory,
  saveMemory,
  getBodyProfile,
  saveBodyProfile,
  listMeasurementProfiles,
  saveMeasurementProfile,
  removeMeasurementProfile,
  applyReferralCode,
  listReferralHistory,
  getReferralDashboard,
  listGrowthOffers,
  saveGrowthOffer,
  validateGrowthOffer,
  claimGrowthOffer,
  isAllowedAdminEmail,
};
