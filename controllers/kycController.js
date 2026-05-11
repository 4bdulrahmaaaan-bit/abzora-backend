const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');

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

async function getMyVendorKycRequest(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
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
      actorName: payload.ownerName || req.user?.name || req.dbUser?.name || 'ABZORA Member',
      action: existing ? 'resubmitted' : 'submitted',
      note: existing
        ? 'Vendor KYC re-submitted with updated documents.'
        : 'Initial vendor KYC submission.',
      timestamp: nowIso,
    });

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
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedByName: '',
        reviewedAt: '',
        actionHistory: history,
        verification: payload.verification || existing?.verification || {},
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ success: true, data: serializeVendorKyc(item) });
  } catch (error) {
    return next(error);
  }
}

async function getMyRiderKycRequest(req, res, next) {
  try {
    const userId = req.user?.uid || req.user?.firebaseUid;
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
      actorName: payload.name || req.user?.name || req.dbUser?.name || 'ABZORA Member',
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
        status: 'pending',
        rejectionReason: '',
        reviewedBy: '',
        reviewedByName: '',
        reviewedAt: '',
        actionHistory: history,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({ success: true, data: serializeRiderKyc(item) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMyVendorKycRequest,
  submitVendorKycRequest,
  getMyRiderKycRequest,
  submitRiderKycRequest,
};
