const reviewService = require('../services/reviewService');
const reviewAnalyticsService = require('../services/reviewAnalyticsService');

exports.getReviews = async (req, res) => {
  try {
    const { page, limit, ...filters } = req.query;
    const vendorId = req.user.vendorId || req.user.uid;
    const result = await reviewService.getReviews(vendorId, {
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
    const data = await reviewAnalyticsService.getAnalytics(vendorId, startDate, endDate);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.addReply = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.user.uid;
    const reply = await reviewService.addReply(req.params.reviewId, vendorId, req.body.message);
    res.json({ success: true, data: reply });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.editReply = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.user.uid;
    // Assuming edit is via PATCH on the reply directly, but requirements said /vendor/reviews/:reviewId/reply
    // We'll update the single reply for the review
    const reply = await reviewService.editReply(req.params.reviewId, vendorId, req.body.message);
    res.json({ success: true, data: reply });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteReply = async (req, res) => {
  try {
    const vendorId = req.user.vendorId || req.user.uid;
    await reviewService.deleteReply(req.params.reviewId, vendorId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
