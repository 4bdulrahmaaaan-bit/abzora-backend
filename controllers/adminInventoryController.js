const adminInventoryAnalyticsService = require('../services/adminInventoryAnalyticsService');
const Product = require('../models/Product');
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

exports.getDashboard = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const [kpis, alerts] = await Promise.all([
      adminInventoryAnalyticsService.getDashboardKPIs(),
      adminInventoryAnalyticsService.getAlerts(),
    ]);

    return res.status(200).json({ success: true, data: { kpis, alerts } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.getProducts = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 50;
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.vendorId) filter.vendorId = req.query.vendorId;
    if (req.query.status) filter.status = req.query.status;

    const items = await Product.find(filter)
      .select('name vendorId category sku inventory price status updatedAt')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    
    const totalCount = await Product.countDocuments(filter);

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

exports.adjustInventory = async (req, res) => {
  const authError = ensureAdmin(req, res);
  if (authError) return authError;

  try {
    const productId = req.params.id;
    const { available, reserved, trialReserved } = req.body;

    const previousState = await Product.findById(productId).select('inventory').lean();
    if (!previousState) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }

    const updates = {};
    if (available !== undefined) updates['inventory.available'] = available;
    if (reserved !== undefined) updates['inventory.reserved'] = reserved;
    if (trialReserved !== undefined) updates['inventory.trialReserved'] = trialReserved;

    const newProduct = await Product.findByIdAndUpdate(
      productId,
      { $set: updates },
      { new: true }
    ).select('inventory').lean();

    await AdminActivityLog.create({
      logId: `log-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      actorId: String(req.user?.uid || 'system').trim(),
      actorRole: String(req.user?.role || 'admin').trim(),
      action: 'ADJUST_INVENTORY',
      targetType: 'Product',
      targetId: productId,
      message: `Adjusted inventory for product ${productId}`,
      previousState,
      newState: newProduct,
      timestampIso: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, data: newProduct });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
