const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');

function toIsoNow() {
  return new Date().toISOString();
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
        storeName: payload.storeName || '',
        ownerName: payload.ownerName || req.user?.name || req.dbUser?.name || '',
        phone: payload.phone || req.user?.phone || req.dbUser?.phone || '',
        address: payload.address || '',
        city: payload.city || '',
        latitude: Number(payload.latitude || 0),
        longitude: Number(payload.longitude || 0),
        kyc: payload.kyc || {},
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
        name: payload.name || req.user?.name || req.dbUser?.name || '',
        phone: payload.phone || req.user?.phone || req.dbUser?.phone || '',
        vehicle: payload.vehicle || '',
        city: payload.city || '',
        kyc: payload.kyc || {},
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
