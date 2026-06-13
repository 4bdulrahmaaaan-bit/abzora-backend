const Product = require('../models/Product');

class AdminInventoryAnalyticsService {
  async getDashboardKPIs() {
    // We aggregate Product items. Assume product.inventory contains { available, reserved, lowStockThreshold } etc.
    // Given the structure might vary, we will safely do basic count aggregations.
    const [inventoryStats] = await Product.aggregate([
      {
        $group: {
          _id: null,
          totalAvailable: { $sum: { $ifNull: ['$inventory.available', 0] } },
          totalReserved: { $sum: { $ifNull: ['$inventory.reserved', 0] } },
          totalTrialReserved: { $sum: { $ifNull: ['$inventory.trialReserved', 0] } },
          inventoryValue: { $sum: { $multiply: [{ $ifNull: ['$inventory.available', 0] }, { $ifNull: ['$price', 0] }] } },
          lowStockCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gt: [{ $ifNull: ['$inventory.available', 0] }, 0] },
                    { $lte: [{ $ifNull: ['$inventory.available', 0] }, { $ifNull: ['$inventory.lowStockThreshold', 5] }] }
                  ]
                },
                1,
                0
              ]
            }
          },
          outOfStockCount: {
            $sum: { $cond: [{ $lte: [{ $ifNull: ['$inventory.available', 0] }, 0] }, 1, 0] }
          }
        }
      }
    ]);

    const stats = inventoryStats || {
      totalAvailable: 0,
      totalReserved: 0,
      totalTrialReserved: 0,
      inventoryValue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
    };

    const totalInventory = stats.totalAvailable + stats.totalReserved + stats.totalTrialReserved;
    const deadStockPercent = 2.4; // Mocked
    const reservedPercent = totalInventory > 0 ? ((stats.totalReserved + stats.totalTrialReserved) / totalInventory) * 100 : 0;

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
      deadStockProducts: 14, // Mocked
      inventoryValue: stats.inventoryValue,
      inventoryHealthScore: healthScore,
      deadStockPercent,
      reservedStockPercent: reservedPercent,
    };
  }

  async getAlerts() {
    return [
      { id: '1', type: 'Low Stock', message: 'SKU-1001 is below threshold (2 left)', severity: 'Warning', createdAt: new Date() },
      { id: '2', type: 'Out Of Stock', message: 'SKU-2099 is out of stock', severity: 'Critical', createdAt: new Date() },
      { id: '3', type: 'Dead Stock', message: 'SKU-5544 has no movement for 90 days', severity: 'Warning', createdAt: new Date() },
    ];
  }
}

module.exports = new AdminInventoryAnalyticsService();
