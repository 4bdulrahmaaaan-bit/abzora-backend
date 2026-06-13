const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const AdminActivityLog = require('../models/AdminActivityLog');
const { isAllowedAdminEmail } = require('./authController');

function ensureAdmin(req, res) {
  const hasPrivilegedRole = req.user?.role === 'admin' || req.user?.role === 'super_admin';
  const emailAllowed = isAllowedAdminEmail(req.user?.email || req.dbUser?.email);
  if (!hasPrivilegedRole && !emailAllowed) {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  return null;
}

async function logCouponAction(req, action, couponId, previousState, newState, message) {
  try {
    await AdminActivityLog.create({
      logId: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      actorId: String(req.user?.uid || 'system').trim(),
      actorRole: String(req.user?.role || 'admin').trim(),
      action,
      targetType: 'Coupon',
      targetId: String(couponId),
      message,
      previousState,
      newState,
      timestampIso: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to log coupon action:', error);
  }
}

exports.getCouponsDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const [activeCoupons, totalRedemptions, totalDiscountProvided] = await Promise.all([
      Coupon.countDocuments({ status: 'active', vendorId: 'ADMIN' }),
      CouponRedemption.countDocuments(),
      CouponRedemption.aggregate([
        { $group: { _id: null, total: { $sum: '$discountApplied' } } }
      ])
    ]);

    return res.status(200).json({
      success: true,
      data: {
        activeCoupons,
        totalRedemptions,
        totalDiscountProvided: totalDiscountProvided[0]?.total || 0,
        roi: '12%', // Mock ROI
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.listCoupons = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = { vendorId: 'ADMIN' }; // Admin only sees admin coupons here
    if (req.query.status) filter.status = req.query.status;

    const items = await Coupon.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    // Attach analytics
    for (const item of items) {
      item.redemptions = await CouponRedemption.countDocuments({ couponId: item._id });
      const agg = await CouponRedemption.aggregate([
        { $match: { couponId: item._id } },
        { $group: { _id: null, total: { $sum: '$discountApplied' } } }
      ]);
      item.totalDiscount = agg[0]?.total || 0;
    }

    const totalCount = await Coupon.countDocuments(filter);

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

exports.createCoupon = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const payload = { ...req.body, vendorId: 'ADMIN' };
    const coupon = await Coupon.create(payload);
    
    await logCouponAction(req, 'CREATE_COUPON', coupon._id, null, coupon, `Created platform coupon ${coupon.couponCode}`);

    return res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateCoupon = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const couponId = req.params.id;
    const previousState = await Coupon.findById(couponId).lean();
    
    const updates = { ...req.body };
    delete updates._id;

    const coupon = await Coupon.findByIdAndUpdate(
      couponId,
      { $set: updates },
      { new: true }
    ).lean();

    if (coupon) {
      await logCouponAction(req, 'UPDATE_COUPON', couponId, previousState, coupon, `Updated platform coupon ${coupon.couponCode}`);
    }

    return res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
