const Coupon = require('../models/Coupon');
const CouponRedemption = require('../models/CouponRedemption');
const Order = require('../models/Order');
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

function normalizeCouponPayload(body = {}) {
  const eligibleUserIds = Array.isArray(body.eligibleUserIds)
    ? body.eligibleUserIds.map((item) => String(item).trim()).filter(Boolean)
    : String(body.eligibleUserIds || '')
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean);

  const payload = {
    couponCode: String(body.couponCode || '').trim().toUpperCase(),
    discountType: body.discountType,
    discountValue: Number(body.discountValue || 0),
    minimumOrderValue: Number(body.minimumOrderValue || 0),
    status: body.status,
    startDate: body.startDate,
    endDate: body.endDate,
    vendorId: 'ADMIN',
    eligibleUserIds,
    firstOrderOnly: Boolean(body.firstOrderOnly),
  };

  payload.maximumDiscount =
    body.maximumDiscount !== undefined && body.maximumDiscount !== null && body.maximumDiscount !== ''
      ? Number(body.maximumDiscount)
      : null;
  payload.usageLimit =
    body.usageLimit !== undefined && body.usageLimit !== null && body.usageLimit !== ''
      ? Number(body.usageLimit)
      : null;
  return payload;
}

exports.getCouponsDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const [activeCoupons, totalRedemptions, discountAgg, redemptions] = await Promise.all([
      Coupon.countDocuments({ status: 'active', vendorId: 'ADMIN' }),
      CouponRedemption.countDocuments(),
      CouponRedemption.aggregate([
        { $group: { _id: null, total: { $sum: '$discountAmount' } } }
      ]),
      CouponRedemption.find().select('orderId discountAmount').lean(),
    ]);

    const orderIds = redemptions.map((item) => item.orderId).filter(Boolean);
    const orders = orderIds.length
      ? await Order.find({ _id: { $in: orderIds } }).select('finalAmount').lean()
      : [];
    const totalOrderValue = orders.reduce((sum, order) => sum + Number(order.finalAmount || 0), 0);
    const totalDiscountProvided = redemptions.reduce((sum, redemption) => sum + Number(redemption.discountAmount || 0), 0);
    const roi = totalOrderValue > 0
      ? `${Math.round((totalDiscountProvided / totalOrderValue) * 1000) / 10}%`
      : '0%';

    return res.status(200).json({
      success: true,
      data: {
        activeCoupons,
        totalRedemptions,
        totalDiscountProvided: discountAgg[0]?.total || totalDiscountProvided,
        roi,
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
    const payload = normalizeCouponPayload(req.body);
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
    
    const updates = normalizeCouponPayload(req.body);
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

exports.deleteCoupon = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const couponId = req.params.id;
    const previousState = await Coupon.findById(couponId).lean();
    if (!previousState) {
      return res.status(404).json({ success: false, message: 'Coupon not found.' });
    }

    await Coupon.deleteOne({ _id: couponId, vendorId: 'ADMIN' });
    await logCouponAction(
      req,
      'DELETE_COUPON',
      couponId,
      previousState,
      null,
      `Deleted platform coupon ${previousState.couponCode}`
    );

    return res.status(200).json({ success: true, data: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
