const mongoose = require('mongoose');

const vendorMetricsMonthlySchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true, trim: true, index: true },
    storeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Store', required: true, index: true },
    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true },

    totalRevenue: { type: Number, default: 0, min: 0 },
    totalOrders: { type: Number, default: 0, min: 0 },
    totalUnitsSold: { type: Number, default: 0, min: 0 },
    averageOrderValue: { type: Number, default: 0, min: 0 },

    totalCustomers: { type: Number, default: 0, min: 0 },
    newCustomers: { type: Number, default: 0, min: 0 },
    returningCustomers: { type: Number, default: 0, min: 0 },

    conversionRate: { type: Number, default: 0, min: 0 },

    totalRefunds: { type: Number, default: 0, min: 0 },
    refundAmount: { type: Number, default: 0, min: 0 },

    trialOrders: { type: Number, default: 0, min: 0 },
    trialConversions: { type: Number, default: 0, min: 0 },
    trialRevenue: { type: Number, default: 0, min: 0 },

    extraMetrics: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'vendor_metrics_monthly' }
);

vendorMetricsMonthlySchema.index({ vendorId: 1, year: 1, month: 1 }, { unique: true });
vendorMetricsMonthlySchema.index({ storeId: 1, year: 1, month: 1 });

module.exports = mongoose.model('VendorMetricsMonthly', vendorMetricsMonthlySchema);
