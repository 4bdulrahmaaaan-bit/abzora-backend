const mongoose = require('mongoose');

const Store = require('../models/Store');
const Product = require('../models/Product');
const Order = require('../models/Order');

async function resolveVendorStore(user) {
  if (!user?.uid) return null;
  const candidates = [user.storeId, user.vendorStoreId].filter(Boolean);
  if (candidates.length > 0) {
    const valid = candidates.find((id) => mongoose.Types.ObjectId.isValid(id));
    if (valid) {
      const store = await Store.findById(valid);
      if (store && store.ownerId === user.uid) return store;
    }
  }
  return Store.findOne({ ownerId: user.uid });
}

function parseSince(queryRange) {
  const now = new Date();
  if (queryRange === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (queryRange === '30d') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

function safeDiv(a, b) {
  if (!b) return 0;
  return a / b;
}

function priorityLabel(score) {
  if (score >= 75) return 'High';
  if (score >= 45) return 'Medium';
  return 'Low';
}

function buildProductAction(product) {
  const conversion = safeDiv(product.purchaseCount || 0, product.viewCount || 0);
  const inventory = product.stock || 0;
  if (inventory <= 3) return 'Restock';
  if (conversion < 0.02 && inventory > 10) return 'Reduce price';
  if (conversion < 0.03) return 'Increase discount';
  return 'Performing well';
}

async function getGrowthSummary(req, res, next) {
  try {
    const store = await resolveVendorStore(req.user);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found for vendor.' });
    }
    const since = parseSince(req.query.range?.toString().trim().toLowerCase());
    const orders = await Order.find({
      storeId: store._id,
      createdAt: { $gte: since },
      status: { $nin: ['Cancelled'] },
    }).lean();
    const completed = orders.filter((o) => ['Delivered', 'Completed'].includes(o.status));
    const revenue = completed.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    const conversionRate = orders.length === 0 ? 0 : (completed.length / orders.length) * 100;
    const avgOrderValue = completed.length === 0 ? 0 : revenue / completed.length;
    return res.status(200).json({
      success: true,
      data: {
        revenue,
        conversionRate,
        orders: completed.length,
        avgOrderValue,
        totalOrders: orders.length,
        timeframe: req.query.range || '7d',
      },
    });
  } catch (error) {
    return next(error);
  }
}

async function getGrowthRecommendations(req, res, next) {
  try {
    const store = await resolveVendorStore(req.user);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found for vendor.' });
    }
    const products = await Product.find({ storeId: store._id, isActive: true }).limit(100).lean();
    const recommendations = [];
    for (const product of products) {
      const conversion = safeDiv(product.purchaseCount || 0, product.viewCount || 0);
      if (conversion < 0.02 && (product.stock || 0) > 10) {
        recommendations.push({
          type: 'pricing_optimization',
          productId: product._id.toString(),
          title: 'Reduce price to increase sales',
          message: `Lower price by ₹300 for ${product.name} to improve conversion.`,
          priority: priorityLabel(82),
          recommendation: 'Apply Price Suggestion',
        });
      }
      if ((product.stock || 0) > 20 && conversion < 0.03) {
        recommendations.push({
          type: 'discount_opportunity',
          productId: product._id.toString(),
          title: 'Apply discount to clear stock',
          message: `Apply 20% discount on ${product.name} to clear slow-moving inventory.`,
          priority: priorityLabel(67),
          recommendation: 'Apply Discount',
        });
      }
      if ((product.demandScore || 0) > 70 && conversion > 0.06) {
        recommendations.push({
          type: 'high_demand_alert',
          productId: product._id.toString(),
          title: 'High demand detected',
          message: `Increase price by ₹200 for ${product.name} to maximize margin.`,
          priority: priorityLabel(74),
          recommendation: 'View Pricing',
        });
      }
      if ((product.stock || 0) <= 3) {
        recommendations.push({
          type: 'stock_alert',
          productId: product._id.toString(),
          title: 'Low stock remaining',
          message: `${product.name} is low in stock. Restock soon.`,
          priority: priorityLabel(90),
          recommendation: 'Manage Stock',
        });
      }
    }
    return res.status(200).json({ success: true, data: recommendations.slice(0, 20) });
  } catch (error) {
    return next(error);
  }
}

async function getGrowthProductPerformance(req, res, next) {
  try {
    const store = await resolveVendorStore(req.user);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found for vendor.' });
    }
    const products = await Product.find({ storeId: store._id, isActive: true }).limit(100).lean();
    const performance = products.map((product) => {
      const views = Number(product.viewCount || 0);
      const purchases = Number(product.purchaseCount || 0);
      const conversionRate = views === 0 ? 0 : (purchases / views) * 100;
      return {
        productId: product._id.toString(),
        productName: product.name,
        views,
        purchases,
        conversionRate,
        currentPrice: Number(product.price || 0),
        suggestedAction: buildProductAction(product),
      };
    });
    return res.status(200).json({ success: true, data: performance });
  } catch (error) {
    return next(error);
  }
}

async function getGrowthCharts(req, res, next) {
  try {
    const store = await resolveVendorStore(req.user);
    if (!store) {
      return res.status(404).json({ success: false, message: 'Store not found for vendor.' });
    }
    const products = await Product.find({ storeId: store._id, isActive: true }).limit(60).lean();
    const chart = products
      .map((p) => ({
        productId: p._id.toString(),
        productName: p.name,
        price: Number(p.price || 0),
        conversionRate:
          p.viewCount > 0 ? (Number(p.purchaseCount || 0) / Number(p.viewCount || 1)) * 100 : 0,
      }))
      .sort((a, b) => a.price - b.price);
    const best = chart.reduce(
      (acc, point) => (point.conversionRate > acc.conversionRate ? point : acc),
      { productId: '', productName: '', price: 0, conversionRate: 0 },
    );
    return res.status(200).json({
      success: true,
      data: {
        points: chart,
        bestPricePoint: best,
      },
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getGrowthSummary,
  getGrowthRecommendations,
  getGrowthProductPerformance,
  getGrowthCharts,
};

