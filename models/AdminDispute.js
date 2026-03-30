const mongoose = require('mongoose');

const adminDisputeSchema = new mongoose.Schema(
  {
    disputeId: { type: String, required: true, unique: true, trim: true },
    orderId: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
    storeId: { type: String, required: true, trim: true },
    type: { type: String, default: 'Dispute', trim: true },
    status: { type: String, default: 'Open', trim: true },
    amount: { type: Number, default: 0, min: 0 },
    reason: { type: String, default: '', trim: true },
    createdAtIso: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminDispute', adminDisputeSchema);
