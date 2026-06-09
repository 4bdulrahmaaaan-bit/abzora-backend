const mongoose = require('mongoose');

const riderSettlementSchema = new mongoose.Schema(
  {
    riderId: { type: String, required: true, index: true },
    settlementPeriodStart: { type: Date, required: true },
    settlementPeriodEnd: { type: Date, required: true },
    grossEarnings: { type: Number, default: 0 },
    adjustments: { type: Number, default: 0 },
    bonuses: { type: Number, default: 0 },
    deductions: { type: Number, default: 0 },
    netPayout: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['pending', 'processing', 'paid', 'failed'],
      default: 'pending',
      index: true
    },
    paidAt: { type: Date },
  },
  {
    timestamps: true,
  }
);

riderSettlementSchema.index({ riderId: 1, settlementPeriodStart: 1, settlementPeriodEnd: 1 });
riderSettlementSchema.index({ riderId: 1, status: 1 });

module.exports = mongoose.model('RiderSettlement', riderSettlementSchema);
