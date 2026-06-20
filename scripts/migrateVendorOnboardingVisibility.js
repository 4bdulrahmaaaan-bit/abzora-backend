require('dotenv').config();
const mongoose = require('mongoose');

const VendorKycRequest = require('../models/VendorKycRequest');
const User = require('../models/User');
const Store = require('../models/Store');

const VISIBLE_STATUSES = new Set([
  'submitted',
  'applied',
  'ocr_review',
  'business_review',
  'finance_review',
  'approved',
  'active',
  'rejected',
  'suspended',
]);

const LEGACY_VISIBLE_STATUSES = new Set([
  'pending',
  'review',
  'draft',
  'incomplete',
  'migrated',
]);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveVisibleStatus(request) {
  const current = normalizeStatus(request.status);
  if (VISIBLE_STATUSES.has(current)) {
    return current;
  }
  if (LEGACY_VISIBLE_STATUSES.has(current)) {
    return 'submitted';
  }
  return current || 'submitted';
}

function toRequestId(userId) {
  return `vendor-${String(userId || '').trim()}`;
}

function toUserCandidates(userId) {
  const normalized = String(userId || '').trim();
  return [
    { uid: normalized },
    { firebaseUid: normalized },
    { phone: normalized },
  ];
}

async function ensureStoreForUser(user, request, applyChanges) {
  const ownerId = user.firebaseUid || user.uid || '';
  const existingStore = await Store.findOne({
    $or: [
      ...(user._id ? [{ vendorId: user._id }] : []),
      ...(ownerId ? [{ ownerId }] : []),
      ...(user.storeId ? [{ _id: user.storeId }] : []),
    ],
  });

  if (existingStore) {
    let changed = false;
    if (!existingStore.vendorId && user._id) {
      existingStore.vendorId = user._id;
      changed = true;
    }
    if (user.storeId !== existingStore._id.toString()) {
      user.storeId = existingStore._id.toString();
      changed = true;
    }
    if (user.role !== 'vendor') {
      user.role = 'vendor';
      changed = true;
    }
    if (user.isActive !== true) {
      user.isActive = true;
      changed = true;
    }
    if (!user.roles?.vendor) {
      user.roles = {
        ...(user.roles instanceof Map ? Object.fromEntries(user.roles.entries()) : (user.roles || {})),
        vendor: true,
      };
      changed = true;
    }
    if (changed && applyChanges) {
      await Promise.all([existingStore.save(), user.save()]);
    }
    return { store: existingStore, changed };
  }

  const nextStore = new Store({
    vendorId: user._id,
    ownerId,
    name: request.storeName || request.ownerName || user.name || 'My Store',
    description: request.address || '',
    logoUrl: request.kyc?.ownerPhotoUrl || '',
    bannerImageUrl: request.kyc?.storeImageUrl || '',
    rating: 0,
    isApproved: true,
    isActive: true,
    approvalStatus: 'approved',
    vendorType: request.vendorType === 'custom_vendor' ? 'custom_vendor' : 'standard_vendor',
    latitude: request.latitude || 0,
    longitude: request.longitude || 0,
    category: Array.isArray(request.specializations) && request.specializations.length > 0
      ? request.specializations[0]
      : 'Fashion',
  });

  user.storeId = nextStore._id.toString();
  user.role = 'vendor';
  user.isActive = true;
  user.roles = {
    ...(user.roles instanceof Map ? Object.fromEntries(user.roles.entries()) : (user.roles || {})),
    vendor: true,
  };

  if (applyChanges) {
    await Promise.all([nextStore.save(), user.save()]);
  }

  return { store: nextStore, changed: true, created: true };
}

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required.');
  }

  const applyChanges = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI, { autoIndex: false });

  const requests = await VendorKycRequest.find({}).sort({ updatedAt: -1, _id: -1 });
  const report = {
    mode: applyChanges ? 'apply' : 'dry-run',
    scanned: requests.length,
    migratedToSubmitted: 0,
    repairedUserRecords: 0,
    createdStores: 0,
    linkedExistingStores: 0,
    skipped: 0,
    items: [],
  };

  for (const request of requests) {
    const nextStatus = resolveVisibleStatus(request);
    const userId = String(request.userId || '').trim();
    const requestId = String(request.requestId || toRequestId(userId)).trim();
    const existingUser = await User.findOne({
      $or: toUserCandidates(userId),
    });

    const itemReport = {
      requestId,
      userId,
      beforeStatus: normalizeStatus(request.status),
      afterStatus: nextStatus,
      userFound: Boolean(existingUser),
      storeLinked: false,
      storeCreated: false,
      changed: false,
    };

    const shouldUpdateRequest = normalizeStatus(request.status) !== nextStatus;
    if (shouldUpdateRequest && applyChanges) {
      request.status = nextStatus;
      request.actionHistory = Array.isArray(request.actionHistory) ? request.actionHistory : [];
      request.actionHistory.push({
        actorId: 'migration-script',
        actorName: 'Migration Script',
        action: 'status_repaired',
        note: `Migrated legacy status to ${nextStatus}.`,
        timestamp: new Date().toISOString(),
      });
      await request.save();
      report.migratedToSubmitted += 1;
      itemReport.changed = true;
    } else if (shouldUpdateRequest) {
      report.migratedToSubmitted += 1;
      itemReport.changed = true;
    }

    if (existingUser) {
      const nextOnboardingStatus = nextStatus;
      const userNeedsUpdate =
        String(existingUser.vendorOnboarding?.status || '').trim().toLowerCase() !== nextOnboardingStatus ||
        existingUser.role !== 'vendor' ||
        !existingUser.storeId;

      if (userNeedsUpdate) {
        existingUser.role = 'vendor';
        existingUser.isActive = true;
        existingUser.roles = {
          ...(existingUser.roles instanceof Map
            ? Object.fromEntries(existingUser.roles.entries())
            : (existingUser.roles || {})),
          vendor: true,
        };
        existingUser.vendorOnboarding = {
          ...(existingUser.vendorOnboarding || {}),
          status: nextOnboardingStatus,
          isCompleted: nextOnboardingStatus === 'approved' || nextOnboardingStatus === 'active',
          resubmissionRequired: nextOnboardingStatus === 'rejected',
          requestId,
        };
      }

      const storeResult = await ensureStoreForUser(existingUser, request, applyChanges);
      if (storeResult.created) {
        report.createdStores += 1;
        itemReport.storeCreated = true;
        itemReport.changed = true;
      } else if (storeResult.changed) {
        report.linkedExistingStores += 1;
        itemReport.storeLinked = true;
        itemReport.changed = true;
      }

      if (userNeedsUpdate) {
        if (applyChanges) {
          await existingUser.save();
        }
        report.repairedUserRecords += 1;
        itemReport.changed = true;
      }
    } else {
      report.skipped += 1;
    }

    if (itemReport.changed) {
      report.items.push(itemReport);
    }
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {
      // ignore disconnect errors
    }
  });
