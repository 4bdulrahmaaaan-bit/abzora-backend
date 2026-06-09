const VendorHealthScore = require('../models/VendorHealthScore');
const Store = require('../models/Store');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Review = require('../models/Review');
const ReturnRequest = require('../models/ReturnRequest');
const RefundRequest = require('../models/RefundRequest');
const VendorMetricsMonthly = require('../models/VendorMetricsMonthly');
const vendorNotificationService = require('./vendorNotificationService');

class BusinessHealthService {
  async getHealthScore(vendorId) {
    let healthScore = await VendorHealthScore.findOne({ vendorId }).lean();
    if (!healthScore) {
      healthScore = await this.recalculateHealth(vendorId);
    }
    return healthScore;
  }

  async recalculateHealth(vendorId) {
    // 1. Store Health
    const store = await Store.findOne({ vendorId }).lean() || {};
    let storeHealth = 50;
    if (store.logoUrl) storeHealth += 10;
    if (store.bannerUrl) storeHealth += 10;
    if (store.policies && store.policies.length > 0) storeHealth += 10;
    if (store.shippingSettings) storeHealth += 10;
    if (store.returnSettings) storeHealth += 10;

    // 2. Inventory Health
    const products = await Product.find({ vendorId }).lean();
    let inventoryHealth = 100;
    let outOfStockCount = 0;
    let lowStockCount = 0;

    products.forEach((p) => {
      const stock = p.inventoryCount || 0;
      if (stock === 0) outOfStockCount++;
      else if (stock < 5) lowStockCount++;
    });

    if (products.length > 0) {
      const oosPercent = outOfStockCount / products.length;
      const lsPercent = lowStockCount / products.length;
      inventoryHealth = Math.max(0, 100 - (oosPercent * 100) - (lsPercent * 50));
    }

    // 3. Fulfillment Health
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const orders = await Order.find({ vendorId, createdAt: { $gte: thirtyDaysAgo } }).lean();
    let fulfillmentHealth = 100;
    let cancelledOrders = 0;
    let deliveredOrders = 0;
    let totalFulfillmentTime = 0;

    orders.forEach((o) => {
      if (o.status === 'cancelled') cancelledOrders++;
      if (o.status === 'delivered') {
        deliveredOrders++;
        const created = new Date(o.createdAt).getTime();
        const updated = new Date(o.updatedAt).getTime(); // assuming updatedAt marks delivery
        totalFulfillmentTime += (updated - created);
      }
    });

    if (orders.length > 0) {
      const cancelRate = cancelledOrders / orders.length;
      fulfillmentHealth = Math.max(0, 100 - (cancelRate * 100)); // Subtract cancel rate points
    }

    // 4. Review Health
    const reviews = await Review.find({ vendorId }).lean();
    let reviewHealth = 100;
    let totalRating = 0;
    let negativeReviews = 0;

    reviews.forEach((r) => {
      totalRating += r.rating;
      if (r.rating <= 2) negativeReviews++;
    });

    if (reviews.length > 0) {
      const avgRating = totalRating / reviews.length;
      const negativePercent = negativeReviews / reviews.length;
      reviewHealth = (avgRating / 5) * 100; // Base on avg rating
      reviewHealth = Math.max(0, reviewHealth - (negativePercent * 20)); // Penalize high negative volume
    }

    // 5. Return Health
    const returns = await ReturnRequest.find({ vendorId, createdAt: { $gte: thirtyDaysAgo } }).lean();
    const refunds = await RefundRequest.find({ vendorId, createdAt: { $gte: thirtyDaysAgo } }).lean();
    let returnHealth = 100;

    if (orders.length > 0) {
      const returnRate = returns.length / orders.length;
      const refundRate = refunds.length / orders.length;
      returnHealth = Math.max(0, 100 - (returnRate * 100) - (refundRate * 50));
    }

    // 6. Revenue Health
    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const metrics = await VendorMetricsMonthly.findOne({ vendorId, month: currentMonth, year: currentYear }).lean();
    let revenueHealth = 80; // Default good base
    if (metrics) {
      if (metrics.totalOrders > 10) revenueHealth += 10;
      if (metrics.conversionRate > 2) revenueHealth += 10;
    }

    // Calculate Overall Score
    const businessScore = Math.round(
      (storeHealth + inventoryHealth + fulfillmentHealth + reviewHealth + returnHealth + revenueHealth) / 6
    );

    // Generate Recommendations
    const recommendations = [];
    if (storeHealth < 80) recommendations.push('Complete your store profile and policies to build trust.');
    if (inventoryHealth < 80) recommendations.push('Restock products. You have high out-of-stock or low-stock items.');
    if (fulfillmentHealth < 90) recommendations.push('Improve acceptance rate by fulfilling orders faster.');
    if (reviewHealth < 80) recommendations.push('Improve product quality to reduce negative reviews.');
    if (returnHealth < 85) recommendations.push('Review sizing accuracy and product descriptions to lower return rates.');

    // Save Score
    const scoreData = {
      businessScore,
      storeHealth: Math.round(storeHealth),
      inventoryHealth: Math.round(inventoryHealth),
      fulfillmentHealth: Math.round(fulfillmentHealth),
      reviewHealth: Math.round(reviewHealth),
      returnHealth: Math.round(returnHealth),
      revenueHealth: Math.round(revenueHealth),
      recommendations,
      calculatedAt: new Date(),
    };

    const previousScore = await VendorHealthScore.findOne({ vendorId }).lean();
    
    const updatedScore = await VendorHealthScore.findOneAndUpdate(
      { vendorId },
      { $set: scoreData },
      { upsert: true, new: true }
    );

    // Notifications
    if (previousScore && businessScore < previousScore.businessScore - 10) {
      await vendorNotificationService.createNotification(vendorId, {
        title: 'Business Score Drop',
        message: `Your business score dropped by more than 10 points. Check your health recommendations.`,
        type: 'business_score_drop',
        priority: 'high',
        entityId: vendorId,
        entityType: 'VendorHealth',
        targetRoute: '/vendor/business-health',
      });
    }

    if (inventoryHealth < 50) {
      await vendorNotificationService.createNotification(vendorId, {
        title: 'Low Inventory Health',
        message: `Multiple products are out of stock. Restock immediately.`,
        type: 'low_inventory',
        priority: 'high',
        entityId: vendorId,
        entityType: 'VendorHealth',
        targetRoute: '/vendor/products',
      });
    }

    return updatedScore;
  }
}

module.exports = new BusinessHealthService();
