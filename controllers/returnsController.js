const returnsService = require('../services/returnsService');
const returnAnalyticsService = require('../services/returnAnalyticsService');

exports.getReturns = async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await returnsService.getReturns(vendorId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      ...filters,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getRefunds = async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await returnsService.getRefunds(vendorId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      ...filters,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getExchanges = async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await returnsService.getExchanges(vendorId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      ...filters,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const vendorId = req.user.vendorId || req.user.uid;
    const data = await returnAnalyticsService.getAnalytics(vendorId, startDate, endDate);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateReturnStatus = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await returnsService.updateReturnStatus(req.params.id, vendorId, req.body.status);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateRefundStatus = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await returnsService.updateRefundStatus(req.params.id, vendorId, req.body.status);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.updateExchangeStatus = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await returnsService.updateExchangeStatus(req.params.id, vendorId, req.body.status);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
