const couponService = require('../services/couponService');

exports.createCoupon = async (req, res) => {
  try {
    const data = { ...req.body, vendorId: req.user.id };
    const coupon = await couponService.createCoupon(data);
    res.status(201).json(coupon);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getCoupons = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const coupons = await couponService.getCoupons(vendorId);
    res.json({ coupons });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateCoupon = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const coupon = await couponService.updateCoupon(id, vendorId, req.body);
    res.json(coupon);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const { status } = req.body;
    const coupon = await couponService.updateStatus(id, vendorId, status);
    res.json(coupon);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const result = await couponService.deleteCoupon(id, vendorId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
