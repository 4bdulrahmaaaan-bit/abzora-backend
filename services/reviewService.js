const Review = require('../models/Review');
const ReviewReply = require('../models/ReviewReply');
const vendorNotificationService = require('./vendorNotificationService');

class ReviewService {
  async getReviews(vendorId, options = {}) {
    const { page = 1, limit = 20, sort = { createdAt: -1 }, ...filters } = options;
    const skip = (page - 1) * limit;
    
    const query = { vendorId, ...filters };
    const [reviews, total] = await Promise.all([
      Review.find(query).sort(sort).skip(skip).limit(limit).lean(),
      Review.countDocuments(query),
    ]);

    // Fetch replies for these reviews
    const reviewIds = reviews.map((r) => r._id);
    const replies = await ReviewReply.find({ reviewId: { $in: reviewIds } }).lean();
    
    const replyMap = replies.reduce((acc, reply) => {
      acc[reply.reviewId.toString()] = reply;
      return acc;
    }, {});

    const enrichedReviews = reviews.map((r) => ({
      ...r,
      reply: replyMap[r._id.toString()] || null,
    }));

    return {
      reviews: enrichedReviews,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createReview(data) {
    const review = await Review.create(data);
    
    // Notify vendor
    await vendorNotificationService.createNotification(review.vendorId, {
      title: 'New Review Received',
      message: `A new ${review.rating}-star review was posted for your product.`,
      type: 'review_received',
      priority: review.rating <= 3 ? 'high' : 'normal',
      entityId: review._id.toString(),
      entityType: 'Review',
      targetRoute: '/vendor/reviews',
    });

    if (review.rating <= 3) {
      await vendorNotificationService.createNotification(review.vendorId, {
        title: 'Review Reply Required',
        message: `A negative review (${review.rating} stars) requires your attention and reply.`,
        type: 'review_action_required',
        priority: 'high',
        entityId: review._id.toString(),
        entityType: 'Review',
        targetRoute: '/vendor/reviews',
      });
    }

    return review;
  }

  async updateReview(reviewId, customerId, updates) {
    const review = await Review.findOneAndUpdate(
      { _id: reviewId, customerId },
      { $set: updates },
      { new: true }
    );
    if (!review) throw new Error('Review not found or unauthorized');
    return review;
  }

  async deleteReview(reviewId, customerId) {
    const review = await Review.findOneAndDelete({ _id: reviewId, customerId });
    if (!review) throw new Error('Review not found or unauthorized');
    await ReviewReply.deleteMany({ reviewId });
    return review;
  }

  // Vendor Actions
  async addReply(reviewId, vendorId, message) {
    const review = await Review.findOne({ _id: reviewId, vendorId });
    if (!review) throw new Error('Review not found or unauthorized');

    const existingReply = await ReviewReply.findOne({ reviewId });
    if (existingReply) throw new Error('Reply already exists');

    const reply = await ReviewReply.create({ reviewId, vendorId, message });
    return reply;
  }

  async editReply(reviewId, vendorId, message) {
    const reply = await ReviewReply.findOneAndUpdate(
      { reviewId, vendorId },
      { $set: { message } },
      { new: true }
    );
    if (!reply) throw new Error('Reply not found or unauthorized');
    return reply;
  }

  async deleteReply(reviewId, vendorId) {
    const reply = await ReviewReply.findOneAndDelete({ reviewId, vendorId });
    if (!reply) throw new Error('Reply not found or unauthorized');
    return reply;
  }
}

module.exports = new ReviewService();
