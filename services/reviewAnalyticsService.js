const mongoose = require('mongoose');
const Review = require('../models/Review');

class ReviewAnalyticsService {
  async getAnalytics(vendorId, startDate, endDate) {
    const matchStage = { vendorId };
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const [generalMetrics] = await Review.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating' },
          reviewCount: { $sum: 1 },
          positiveCount: { $sum: { $cond: [{ $gte: ['$rating', 4] }, 1, 0] } },
          negativeCount: { $sum: { $cond: [{ $lte: ['$rating', 2] }, 1, 0] } },
          rating1: { $sum: { $cond: [{ $eq: ['$rating', 1] }, 1, 0] } },
          rating2: { $sum: { $cond: [{ $eq: ['$rating', 2] }, 1, 0] } },
          rating3: { $sum: { $cond: [{ $eq: ['$rating', 3] }, 1, 0] } },
          rating4: { $sum: { $cond: [{ $eq: ['$rating', 4] }, 1, 0] } },
          rating5: { $sum: { $cond: [{ $eq: ['$rating', 5] }, 1, 0] } },
          trialReviews: { $sum: { $cond: [{ $eq: ['$isTrialOrder', true] }, 1, 0] } },
          trialConversionReviews: { $sum: { $cond: [{ $and: [{ $eq: ['$isTrialOrder', true] }, { $eq: ['$trialOutcome', 'converted'] }] }, 1, 0] } },
          trialReturnReviews: { $sum: { $cond: [{ $and: [{ $eq: ['$isTrialOrder', true] }, { $eq: ['$trialOutcome', 'returned'] }] }, 1, 0] } },
        },
      },
    ]);

    const mostReviewedProducts = await Review.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$productId',
          count: { $sum: 1 },
          averageRating: { $avg: '$rating' },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]);

    if (!generalMetrics) {
      return this._getEmptyMetrics();
    }

    const {
      averageRating,
      reviewCount,
      positiveCount,
      negativeCount,
      rating1,
      rating2,
      rating3,
      rating4,
      rating5,
      trialReviews,
      trialConversionReviews,
      trialReturnReviews,
    } = generalMetrics;

    return {
      averageRating: averageRating || 0,
      reviewCount: reviewCount || 0,
      positivePercent: reviewCount ? (positiveCount / reviewCount) * 100 : 0,
      negativePercent: reviewCount ? (negativeCount / reviewCount) * 100 : 0,
      ratingDistribution: {
        1: rating1,
        2: rating2,
        3: rating3,
        4: rating4,
        5: rating5,
      },
      mostReviewedProducts,
      tbyb: {
        trialReviews,
        trialConversionReviews,
        trialReturnReviews,
      },
    };
  }

  _getEmptyMetrics() {
    return {
      averageRating: 0,
      reviewCount: 0,
      positivePercent: 0,
      negativePercent: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      mostReviewedProducts: [],
      tbyb: {
        trialReviews: 0,
        trialConversionReviews: 0,
        trialReturnReviews: 0,
      },
    };
  }
}

module.exports = new ReviewAnalyticsService();
