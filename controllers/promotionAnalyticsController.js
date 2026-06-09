const promotionAnalyticsService = require('../services/promotionAnalyticsService');

exports.getAnalytics = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const data = await promotionAnalyticsService.getAnalytics(vendorId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
