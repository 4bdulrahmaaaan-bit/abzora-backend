const mongoose = require('mongoose');

const adminDisputeSchema = new mongoose.Schema(
  {
    disputeId: { type: String, required: true, unique: true, trim: true },
    orderId: { type: String, required: true, trim: true },
    userId: { type: String, required: true, trim: true },
    storeId: { type: String, required: true, trim: true },
    type: { type: String, default: 'Dispute', trim: true },
    priority: { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
    status: { type: String, default: 'Open', trim: true },
    amount: { type: Number, default: 0, min: 0 },
    reason: { type: String, default: '', trim: true },
    riderId: { type: String, default: '', trim: true },
    timeline: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notes: { type: [mongoose.Schema.Types.Mixed], default: [] },
    evidence: { type: [String], default: [] },
    attachments: { type: [String], default: [] },
    resolutionHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
    createdAtIso: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('AdminDispute', adminDisputeSchema);
