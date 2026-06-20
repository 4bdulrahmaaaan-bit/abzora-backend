const VendorKyc = require('../models/VendorKycRequest');
const RiderKyc = require('../models/RiderKycRequest');
const AdminActivityLog = require('../models/AdminActivityLog');
const User = require('../models/User');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  return null;
}

exports.getDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const [
      pendingVendorKyc,
      approvedVendorKyc,
      rejectedVendorKyc,
      pendingRiderKyc,
      approvedRiderKyc,
      rejectedRiderKyc,
    ] = await Promise.all([
      VendorKyc.countDocuments({ status: { $in: ['submitted', 'applied', 'ocr_review', 'business_review', 'finance_review'] } }),
      VendorKyc.countDocuments({ status: 'approved' }),
      VendorKyc.countDocuments({ status: 'rejected' }),
      RiderKyc.countDocuments({ status: { $in: ['submitted', 'applied', 'kyc_review', 'verification_review', 'training_pending', 'fleet_approval'] } }),
      RiderKyc.countDocuments({ status: 'approved' }),
      RiderKyc.countDocuments({ status: 'rejected' }),
    ]);

    const totalProcessed = approvedVendorKyc + rejectedVendorKyc + approvedRiderKyc + rejectedRiderKyc;
    const totalApproved = approvedVendorKyc + approvedRiderKyc;
    const successRate = totalProcessed > 0 ? (totalApproved / totalProcessed) * 100 : 100;

    const kpis = {
      pendingRequests: pendingVendorKyc + pendingRiderKyc,
      approvedRequests: totalApproved,
      rejectedRequests: rejectedVendorKyc + rejectedRiderKyc,
      averageApprovalTimeHours: 4.2, // Mocked KPI
      verificationSuccessRate: successRate,
      expiredDocuments: 12, // Mocked KPI
      resubmissionRequests: 24, // Mocked KPI
    };

    return res.status(200).json({ success: true, data: kpis });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getKycApplications = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const type = req.query.type || 'Vendor'; // 'Vendor' or 'Rider'
    const status = req.query.status;

    const filter = {};
    if (status) filter.status = status;

    let items = [];
    let totalCount = 0;

    if (type === 'Vendor') {
      items = await VendorKyc.find(filter)
        .select('storeName ownerName phone status kyc createdAt rejectionReason')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      totalCount = await VendorKyc.countDocuments(filter);
    } else {
      items = await RiderKyc.find(filter)
        .select('name phone status kyc createdAt rejectionReason')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
      totalCount = await RiderKyc.countDocuments(filter);
    }

    return res.status(200).json({
      success: true,
      data: items,
      meta: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.reviewKycApplication = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const { id } = req.params;
    const { type, status, notes } = req.body; // type: 'Vendor' or 'Rider'

    const validVendorStatuses = ['submitted', 'applied', 'ocr_review', 'business_review', 'finance_review', 'approved', 'active', 'rejected', 'suspended'];
    const validRiderStatuses = ['submitted', 'applied', 'kyc_review', 'verification_review', 'training_pending', 'fleet_approval', 'active', 'rejected', 'suspended'];

    if (type === 'Vendor' && !validVendorStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid vendor status' });
    }
    if (type === 'Rider' && !validRiderStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid rider status' });
    }

    let previousState;
    let newState;
    const adminName = req.user?.name || req.dbUser?.name || 'Admin';
    const actorId = String(req.user?.uid || 'system').trim();

    const newAction = {
      actorId,
      actorName: adminName,
      action: `status_changed_to_${status}`,
      note: notes || '',
      timestamp: new Date().toISOString()
    };

    if (type === 'Vendor') {
      previousState = await VendorKyc.findById(id).select('status rejectionReason actionHistory userId').lean();
      if (!previousState) return res.status(404).json({ success: false, message: 'Vendor not found' });
      
      newState = await VendorKyc.findByIdAndUpdate(
        id,
        { 
          $set: { 
            status, 
            rejectionReason: status === 'rejected' ? notes : '',
            reviewedBy: actorId,
            reviewedByName: adminName,
            reviewedAt: new Date().toISOString()
          },
          $push: { actionHistory: newAction }
        },
        { new: true }
      ).select('status rejectionReason userId').lean();

      await User.findOneAndUpdate(
        { $or: [{ uid: newState.userId }, { firebaseUid: newState.userId }] },
        {
          $set: {
            'vendorOnboarding.status': status,
            'vendorOnboarding.isCompleted': status === 'approved' || status === 'active',
            'vendorOnboarding.resubmissionRequired': status === 'rejected' || status === 'resubmission',
          }
        }
      );
    } else {
      previousState = await RiderKyc.findById(id).select('status rejectionReason actionHistory userId').lean();
      if (!previousState) return res.status(404).json({ success: false, message: 'Rider not found' });
      
      newState = await RiderKyc.findByIdAndUpdate(
        id,
        { 
          $set: { 
            status, 
            rejectionReason: status === 'rejected' ? notes : '',
            reviewedBy: actorId,
            reviewedByName: adminName,
            reviewedAt: new Date().toISOString()
          },
          $push: { actionHistory: newAction }
        },
        { new: true }
      ).select('status rejectionReason userId').lean();

      await User.findOneAndUpdate(
        { $or: [{ uid: newState.userId }, { firebaseUid: newState.userId }] },
        {
          $set: {
            'riderOnboarding.status': status,
            'riderOnboarding.isCompleted': status === 'approved' || status === 'active',
            'riderOnboarding.resubmissionRequired': status === 'rejected' || status === 'resubmission',
          }
        }
      );
    }

    // Push to AdminActivityLog on any status change
    await AdminActivityLog.create({
      logId: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      actorId,
      actorRole: String(req.user?.role || 'admin').trim(),
      action: 'REVIEW_KYC',
      targetType: type,
      targetId: id,
      message: `Updated KYC status for ${type} ${id} to ${status}. Notes: ${notes || 'none'}`,
      previousState,
      newState,
      timestampIso: new Date().toISOString(),
    });

    // Mock trigger notifications (e.g., via a notification controller if integrated)
    console.log(`[Notification Trigger] User notified about ${type} KYC status changed to ${status}`);

    return res.status(200).json({ success: true, data: newState });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
