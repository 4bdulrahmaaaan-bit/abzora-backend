const Product = require('../models/Product');

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

class AdminInventoryAnalyticsService {
  async getDashboardKPIs() {
    const products = await Product.find()
      .select('stock inventory.updatedAt inventory.lowStockThreshold price isActive updatedAt')
      .lean();

    const stats = {
      totalAvailable: 0,
      totalReserved: 0,
      totalTrialReserved: 0,
      inventoryValue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      deadStockCount: 0,
    };

    const now = Date.now();
    const deadStockWindowMs = 90 * 24 * 60 * 60 * 1000;

    for (const product of products) {
      const available = toNumber(product.stock ?? product.inventory?.available, 0);
      const reserved = toNumber(product.inventory?.reserved, 0);
      const trialReserved = toNumber(product.inventory?.trialReserved, 0);
      const lowStockThreshold = toNumber(product.inventory?.lowStockThreshold, 5);
      const updatedAt = product.updatedAt ? new Date(product.updatedAt).getTime() : 0;

      stats.totalAvailable += available;
      stats.totalReserved += reserved;
      stats.totalTrialReserved += trialReserved;
      stats.inventoryValue += available * toNumber(product.price, 0);

      if (available <= 0) {
        stats.outOfStockCount += 1;
      } else if (available <= lowStockThreshold) {
        stats.lowStockCount += 1;
      }

      if (available <= 0 && updatedAt > 0 && now - updatedAt >= deadStockWindowMs) {
        stats.deadStockCount += 1;
      }
    }

    const totalInventory = stats.totalAvailable + stats.totalReserved + stats.totalTrialReserved;
    const deadStockPercent = products.length > 0 ? (stats.deadStockCount / products.length) * 100 : 0;
    const reservedPercent = totalInventory > 0
      ? ((stats.totalReserved + stats.totalTrialReserved) / totalInventory) * 100
      : 0;

    let healthScore = 'Healthy';
    if (stats.outOfStockCount > 50 || deadStockPercent > 10) healthScore = 'Critical';
    else if (stats.lowStockCount > 100 || reservedPercent > 50) healthScore = 'Warning';

    return {
      totalInventory,
      availableInventory: stats.totalAvailable,
      reservedInventory: stats.totalReserved,
      trialReservedInventory: stats.totalTrialReserved,
      lowStockProducts: stats.lowStockCount,
      outOfStockProducts: stats.outOfStockCount,
      deadStockProducts: stats.deadStockCount,
      inventoryValue: stats.inventoryValue,
      inventoryHealthScore: healthScore,
      deadStockPercent,
      reservedStockPercent: reservedPercent,
    };
  }

  async getAlerts() {
    const products = await Product.find()
      .select('name sku stock inventory.updatedAt inventory.lowStockThreshold isActive updatedAt')
      .lean();

    const alerts = [];
    const now = Date.now();
    for (const product of products) {
      const stock = toNumber(product.stock ?? product.inventory?.available, 0);
      const threshold = toNumber(product.inventory?.lowStockThreshold, 5);
      const updatedAt = product.updatedAt ? new Date(product.updatedAt).getTime() : 0;
      const isDeadStock = stock <= 0 && updatedAt > 0 && (now - updatedAt) >= 90 * 24 * 60 * 60 * 1000;

      if (stock <= 0) {
        alerts.push({
          id: String(product._id),
          type: 'Out Of Stock',
          message: `${product.name || product.sku || 'Product'} is out of stock`,
          severity: 'Critical',
          createdAt: new Date(),
        });
      } else if (stock <= threshold) {
        alerts.push({
          id: String(product._id),
          type: 'Low Stock',
          message: `${product.name || product.sku || 'Product'} is below threshold (${stock} left)`,
          severity: 'Warning',
          createdAt: new Date(),
        });
      }

      if (isDeadStock) {
        alerts.push({
          id: `${product._id}-dead-stock`,
          type: 'Dead Stock',
          message: `${product.name || product.sku || 'Product'} has had no stock movement for 90 days`,
          severity: 'Warning',
          createdAt: new Date(),
        });
      }
    }

    return alerts.slice(0, 25);
  }
}

module.exports = new AdminInventoryAnalyticsService();
