const mongoose = require('mongoose');

const adminPayoutSchema = new mongoose.Schema(
  {
    payoutId: { type: String, required: true, unique: true, trim: true },
    storeId: { type: String, required: true, index: true, trim: true },
    processedBy: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    periodLabel: { type: String, required: true, trim: true },
    createdAtIso: { type: String, required: true, trim: true },
    orderIds: { type: [String], default: [] },
    status: { type: String, default: 'Processed', trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminPayout', adminPayoutSchema);
