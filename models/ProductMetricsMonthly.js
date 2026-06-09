const mongoose = require('mongoose');

const productMetricsMonthlySchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    vendorId: { type: String, required: true, trim: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },

    totalViews: { type: Number, default: 0, min: 0 },
    totalProductClicks: { type: Number, default: 0, min: 0 },
    totalWishlistAdds: { type: Number, default: 0, min: 0 },
    totalAddToCart: { type: Number, default: 0, min: 0 },

    totalPurchases: { type: Number, default: 0, min: 0 },
    totalRevenue: { type: Number, default: 0, min: 0 },
    conversionRate: { type: Number, default: 0, min: 0 },

    returnCount: { type: Number, default: 0, min: 0 },

    trialViews: { type: Number, default: 0, min: 0 },
    trialOrders: { type: Number, default: 0, min: 0 },
    trialConversions: { type: Number, default: 0, min: 0 },

    extraMetrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'product_metrics_monthly' }
);

productMetricsMonthlySchema.index({ productId: 1, year: 1, month: 1 }, { unique: true });
productMetricsMonthlySchema.index({ vendorId: 1, year: 1, month: 1 });

module.exports = mongoose.model('ProductMetricsMonthly', productMetricsMonthlySchema);
