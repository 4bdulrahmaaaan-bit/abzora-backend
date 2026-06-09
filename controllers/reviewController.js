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

exports.listProductReviews = async (req, res) => {
  try {
    const { productId } = req.params;
    const { page, limit, ...filters } = req.query;
    // For product reviews, we might want all reviews for this product
    // Note: The service expects vendorId, so we pass null or bypass it if it's a generic product read
    // But since the service requires a vendorId, we might need to adjust or pass the vendorId if applicable.
    // If this is for customer app, we can fetch from Review directly.
    const result = await require('../services/reviewService').getReviews(null, {
      productId,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      ...filters,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.listStoreReviews = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { page, limit, ...filters } = req.query;
    const result = await require('../services/reviewService').getReviews(storeId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      ...filters,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.saveReview = async (req, res) => {
  try {
    const data = { ...req.body, customerId: req.user.uid };
    const review = await require('../services/reviewService').createReview(data);
    res.status(201).json({ success: true, data: review });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

exports.deleteReview = async (req, res) => {
  try {
    const { id } = req.params;
    const customerId = req.user.uid;
    await require('../services/reviewService').deleteReview(id, customerId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
