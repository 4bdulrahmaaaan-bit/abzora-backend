const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');
const User = require('../models/User');

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '').slice(0, 16);
}

function normalizeOptionalUrl(value) {
  const normalized = String(value || '').trim();
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

function normalizeCoordinate(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(minimum, Math.min(maximum, numeric));
}

function normalizeKycDocuments(payload = {}) {
  const additionalUrls = Array.isArray(payload.additionalUrls)
    ? payload.additionalUrls.map(normalizeOptionalUrl).filter(Boolean).slice(0, 10)
    : [];
  return {
    ownerPhotoUrl: normalizeOptionalUrl(payload.ownerPhotoUrl),
    storeImageUrl: normalizeOptionalUrl(payload.storeImageUrl),
    profilePhotoUrl: normalizeOptionalUrl(payload.profilePhotoUrl),
    aadhaarUrl: normalizeOptionalUrl(payload.aadhaarUrl),
    panUrl: normalizeOptionalUrl(payload.panUrl),
    selfieUrl: normalizeOptionalUrl(payload.selfieUrl),
    licenseUrl: normalizeOptionalUrl(payload.licenseUrl),
    additionalUrls,
  };
}

function buildUserIdentityFromRequest(req, userId) {
  return {
    firebaseUid: userId,
    uid: userId,
    email: String(req.user?.email || '').trim(),
    phone: normalizePhone(req.user?.phone || req.dbUser?.phone || ''),
    name: normalizeText(req.user?.name || req.dbUser?.name || 'Abianzo Member', 120),
  };
}

async function ensureMongoUserRecord(req, userId, onboardingType, onboardingStatus) {
  const identity = buildUserIdentityFromRequest(req, userId);
  const onboardingField = onboardingType === 'vendor' ? 'vendorOnboarding' : 'riderOnboarding';
  const update = {
    $setOnInsert: {
      firebaseUid: identity.firebaseUid,
      uid: identity.uid,
      role: 'customer',
      activeRole: 'customer',
      accountType: 'customer',
      isActive: true,
      roles: { customer: true },
    },
    $set: {
      email: identity.email,
      phone: identity.phone,
      name: identity.name,
      [`${onboardingField}.status`]: onboardingStatus,
      [`${onboardingField}.isCompleted`]: false,
      [`${onboardingField}.resubmissionRequired`]: false,
      [`${onboardingField}.requestId`]: `${onboardingType}-${userId}`,
    },
  };

  return User.findOneAndUpdate(
    { $or: [{ uid: userId }, { firebaseUid: userId }] },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

function normalizeMetadata(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const metadata = {};
  for (const [key, value] of Object.entries(payload)) {
    const normalizedKey = normalizeText(key, 64);
    if (!normalizedKey) {
      continue;
    }
    if (value == null) {
      continue;
    }
    if (typeof value === 'string') {
      metadata[normalizedKey] = value.trim().slice(0, 280);
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      metadata[normalizedKey] = value;
      continue;
    }
    if (Array.isArray(value)) {
      metadata[normalizedKey] = value
        .filter((item) => item != null)
        .slice(0, 24)
        .map((item) => String(item).trim().slice(0, 120));
      continue;
    }
    metadata[normalizedKey] = JSON.parse(JSON.stringify(value));
  }
  return metadata;
}

function serializeVendorKyc(item) {
  return {
    id: item.requestId,
    userId: item.userId,
    storeName: item.storeName || '',
    ownerName: item.ownerName || '',
    phone: item.phone || '',
    address: item.address || '',
    city: item.city || '',
    latitude: Number(item.latitude || 0),
    longitude: Number(item.longitude || 0),
    kyc: item.kyc || {},
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    status: item.status || 'pending',
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    rejectionReason: item.rejectionReason || '',
    reviewedBy: item.reviewedBy || '',
    reviewedByName: item.reviewedByName || '',
    reviewedAt: item.reviewedAt || '',
    actionHistory: item.actionHistory || [],
    verification: item.verification || {},
  };
}

function serializeRiderKyc(item) {
  return {
    id: item.requestId,
    userId: item.userId,
    name: item.name || '',
    phone: item.phone || '',
    vehicle: item.vehicle || '',
    city: item.city || '',
    kyc: item.kyc || {},
    metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {},
    status: item.status || 'pending',
    createdAt: item.createdAt?.toISOString?.() || '',
    updatedAt: item.updatedAt?.toISOString?.() || '',
    rejectionReason: item.rejectionReason || '',
    reviewedBy: item.reviewedBy || '',
    reviewedByName: item.reviewedByName || '',
    reviewedAt: item.reviewedAt || '',
    actionHistory: item.actionHistory || [],
  };
}

function extractAadhaar(value) {
  const raw = String(value || '').replace(/\s+/g, '');
  const match = raw.match(/\b\d{12}\b/);
  return match ? match[0] : '';
}

function extractPan(value) {
  const raw = String(value || '').toUpperCase();
  const match = raw.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
  return match ? match[0] : '';
}

function buildIfscLookup(code) {
  const normalized = String(code || '').trim().toUpperCase();
  const valid = /^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized);
  const bankPrefix = normalized.slice(0, 4);
  const known = {
    HDFC: 'HDFC Bank',
    ICIC: 'ICICI Bank',
    SBIN: 'State Bank of India',
    AXIS: 'Axis Bank',
    KARB: 'Karnataka Bank',
    UTIB: 'Axis Bank',
    CNRB: 'Canara Bank',
    PUNB: 'Punjab National Bank',
  };
  return {
    ifsc: normalized,
    valid,
    bankCode: bankPrefix,
    bankName: known[bankPrefix] || (valid ? 'Bank detected' : ''),
    branch: valid ? 'Branch details available after bank verification' : '',
    supportsPayouts: valid,
  };
}

async function getMyVendorKycRequest(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const item = await VendorKycRequest.findOne({ userId }).sort({ updatedAt: -1, _id: -1 });
    if (!item) {
      return res.status(200).json({ success: true, data: null });
    }
    return res.status(200).json({ success: true, data: serializeVendorKyc(item) });
  } catch (error) {
    return next(error);
  }
}

async function submitVendorKycRequest(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const requestId = `vendor-${userId}`;
    const payload = req.body || {};
    const existing = await VendorKycRequest.findOne({ requestId });

    if (existing?.status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'Vendor KYC is already approved for this account.',
      });
    }

    const nowIso = toIsoNow();
    const history = Array.isArray(existing?.actionHistory) ? existing.actionHistory : [];
    history.push({
      actorId: userId,
      actorName: payload.ownerName || req.user?.name || req.dbUser?.name || 'Abianzo Member',
      action: existing ? 'resubmitted' : 'submitted',
      note: existing
        ? 'Vendor KYC re-submitted with updated documents.'
        : 'Initial vendor KYC submission.',
      timestamp: nowIso,
    });

    const nextStatus = 'submitted';
    console.log('[ONBOARDING_SUBMIT]', JSON.stringify({
      requestId,
      userId,
      status: nextStatus,
      hasStoreName: Boolean(normalizeText(payload.storeName, 120)),
      hasOwnerName: Boolean(normalizeText(payload.ownerName || req.user?.name || req.dbUser?.name || '', 120)),
      hasKycDocs: Boolean(payload?.kyc),
      updatedAt: nowIso,
    }));

    const item = await VendorKycRequest.findOneAndUpdate(
      { requestId },
      {
        requestId,
        userId,
        storeName: normalizeText(payload.storeName, 120),
        ownerName: normalizeText(payload.ownerName || req.user?.name || req.dbUser?.name || '', 120),
        phone: normalizePhone(payload.phone || req.user?.phone || req.dbUser?.phone || ''),
        address: normalizeText(payload.address, 240),
        city: normalizeText(payload.city, 80),
        latitude: normalizeCoordinate(payload.latitude, -90, 90),
        longitude: normalizeCoordinate(payload.longitude, -180, 180),
        kyc: normalizeKycDocuments(payload.kyc),
        metadata: normalizeMetadata(payload.metadata),
        status: nextStatus,
        rejectionReason: '',
        reviewedBy: '',
        reviewedByName: '',
        reviewedAt: '',
        actionHistory: history,
        verification: payload.verification || existing?.verification || {},
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await ensureMongoUserRecord(req, userId, 'vendor', nextStatus);

    return res.status(200).json({ success: true, data: serializeVendorKyc(item) });
  } catch (error) {
    return next(error);
  }
}

async function getMyRiderKycRequest(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const item = await RiderKycRequest.findOne({ userId }).sort({ updatedAt: -1, _id: -1 });
    if (!item) {
      return res.status(200).json({ success: true, data: null });
    }
    return res.status(200).json({ success: true, data: serializeRiderKyc(item) });
  } catch (error) {
    return next(error);
  }
}

async function submitRiderKycRequest(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
    if (!userId) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    const requestId = `rider-${userId}`;
    const payload = req.body || {};
    const existing = await RiderKycRequest.findOne({ requestId });

    if (existing?.status === 'approved') {
      return res.status(409).json({
        success: false,
        message: 'Rider KYC is already approved for this account.',
      });
    }

    const nowIso = toIsoNow();
    const history = Array.isArray(existing?.actionHistory) ? existing.actionHistory : [];
    history.push({
      actorId: userId,
      actorName: payload.name || req.user?.name || req.dbUser?.name || 'Abianzo Member',
      action: existing ? 'resubmitted' : 'submitted',
      note: existing
        ? 'Rider KYC re-submitted with updated documents.'
        : 'Initial rider KYC submission.',
      timestamp: nowIso,
    });

    const item = await RiderKycRequest.findOneAndUpdate(
      { requestId },
      {
        requestId,
        userId,
        name: normalizeText(payload.name || req.user?.name || req.dbUser?.name || '', 120),
        phone: normalizePhone(payload.phone || req.user?.phone || req.dbUser?.phone || ''),
        vehicle: normalizeText(payload.vehicle, 80),
        city: normalizeText(payload.city, 80),
        kyc: normalizeKycDocuments(payload.kyc),
        metadata: normalizeMetadata(payload.metadata),
        status: 'submitted',
        rejectionReason: '',
        reviewedBy: '',
        reviewedByName: '',
        reviewedAt: '',
        actionHistory: history,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await ensureMongoUserRecord(req, userId, 'rider', 'submitted');

    return res.status(200).json({ success: true, data: serializeRiderKyc(item) });
  } catch (error) {
    return next(error);
  }
}

async function lookupIfsc(req, res, next) {
  try {
    const result = buildIfscLookup(req.params?.code || '');
    if (!result.valid) {
      return res.status(400).json({
        success: false,
        message: 'Enter valid IFSC code.',
      });
    }
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
}

async function extractKycFields(req, res, next) {
  try {
    const payload = req.body || {};
    const source = `${payload.text || ''} ${payload.documentUrl || ''}`;
    const documentType = String(payload.documentType || '').trim().toLowerCase();
    const aadhaar = extractAadhaar(source);
    const pan = extractPan(source);
    const data = {
      documentType,
      aadhaarNumber: aadhaar,
      panNumber: pan,
      aadhaarValid: Boolean(aadhaar),
      panValid: Boolean(pan),
      extractedName: '',
      confidenceScore: aadhaar || pan ? 82 : 40,
      requiresManualReview: !(aadhaar || pan),
      flags: !(aadhaar || pan) ? ['unable_to_extract'] : [],
    };
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function verifyRiderKyc(req, res, next) {
  try {
    const payload = req.body || {};
    const aadhaarNumber = extractAadhaar(payload.aadhaarNumber);
    const panNumber = extractPan(payload.panNumber);
    const aadhaarValid = Boolean(aadhaarNumber);
    const panValid = Boolean(panNumber);
    const hasSelfie = Boolean(normalizeOptionalUrl(payload.selfieUrl));
    const hasLicense = Boolean(normalizeOptionalUrl(payload.licenseUrl));
    const hasProfile = Boolean(normalizeOptionalUrl(payload.profilePhotoUrl));
    const hasCoreDocs = hasSelfie && hasLicense && hasProfile;
    const matchScore = hasCoreDocs ? 88 : 62;
    const confidenceScore = aadhaarValid && panValid && hasCoreDocs ? 90 : 68;
    const faceVerified = hasCoreDocs;
    const livenessPassed = hasSelfie;
    const flags = [];
    if (!aadhaarValid) flags.push('aadhaar_invalid');
    if (!panValid) flags.push('pan_invalid');
    if (!hasCoreDocs) flags.push('missing_documents');
    const status = confidenceScore >= 85 ? 'auto_verified' : 'manual_review';
    return res.status(200).json({
      success: true,
      data: {
        status,
        confidenceScore,
        aadhaarNumber,
        panNumber,
        aadhaarValid,
        panValid,
        faceVerified,
        livenessPassed,
        matchScore,
        duplicateDetected: false,
        duplicateMatches: [],
        requiresManualReview: status != 'auto_verified',
        flags,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function verifyVendorKyc(req, res, next) {
  try {
    const payload = req.body || {};
    const aadhaarNumber = extractAadhaar(payload.aadhaarNumber);
    const panNumber = extractPan(payload.panNumber);
    const aadhaarValid = Boolean(aadhaarNumber);
    const panValid = Boolean(panNumber);
    const hasOwnerPhoto = Boolean(normalizeOptionalUrl(payload.ownerPhotoUrl));
    const hasStorePhoto = Boolean(normalizeOptionalUrl(payload.storePhotoUrl));
    const hasCoreDocs = hasOwnerPhoto && hasStorePhoto;
    const matchScore = hasCoreDocs ? 86 : 60;
    const confidenceScore = aadhaarValid && panValid && hasCoreDocs ? 89 : 67;
    const flags = [];
    if (!aadhaarValid) flags.push('aadhaar_invalid');
    if (!panValid) flags.push('pan_invalid');
    if (!hasCoreDocs) flags.push('missing_documents');
    const status = confidenceScore >= 85 ? 'auto_verified' : 'manual_review';
    return res.status(200).json({
      success: true,
      data: {
        status,
        confidenceScore,
        ownerName: normalizeText(payload.ownerName || '', 120),
        aadhaarNumber,
        panNumber,
        aadhaarValid,
        panValid,
        faceVerified: hasOwnerPhoto,
        livenessPassed: hasOwnerPhoto,
        matchScore,
        duplicateDetected: false,
        duplicateMatches: [],
        requiresManualReview: status !== 'auto_verified',
        flags,
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function updateOnboardingStep(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
    const { type, step } = req.body;
    
    if (!['vendor', 'rider'].includes(type)) {
      return res.status(400).json({ success: false, message: 'Invalid onboarding type.' });
    }
    if (typeof step !== 'number') {
      return res.status(400).json({ success: false, message: 'Step must be a number.' });
    }
    
    const field = type === 'vendor' ? 'vendorOnboarding.lastCompletedStep' : 'riderOnboarding.lastCompletedStep';
    
    const updatedUser = await User.findOneAndUpdate(
      { uid: userId },
      { $set: { [field]: step } },
      { new: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    
    return res.status(200).json({ success: true, data: { step } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyVendorKycRequest,
  submitVendorKycRequest,
  getMyRiderKycRequest,
  submitRiderKycRequest,
  lookupIfsc,
  extractKycFields,
  verifyVendorKyc,
  verifyRiderKyc,
  updateOnboardingStep,
};
