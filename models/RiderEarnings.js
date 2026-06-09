const mongoose = require('mongoose');

const riderEarningsSchema = new mongoose.Schema(
  {
    riderId: { type: String, required: true, index: true },
    orderId: { type: String, default: '' },
    trialSessionId: { type: String, default: '' },
    earningType: {
      type: String,
      enum: [
        'delivery',
        'trial_delivery',
        'trial_completion',
        'trial_conversion_bonus',
        'return_pickup',
        'exchange_delivery',
        'incentive',
        'bonus',
        'adjustment'
      ],
      required: true
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'cancelled'],
      default: 'pending',
      index: true
    },
    notes: { type: String, default: '' },
    settlementId: { type: String, default: '', index: true }, // Links to RiderSettlement
  },
  {
    timestamps: true,
  }
);

riderEarningsSchema.index({ riderId: 1, status: 1 });
riderEarningsSchema.index({ riderId: 1, createdAt: 1 });

module.exports = mongoose.model('RiderEarnings', riderEarningsSchema);
