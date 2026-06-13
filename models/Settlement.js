const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema(
  {
    settlementId: { type: String, required: true, unique: true, index: true },
    settlementType: { type: String, enum: ['Vendor', 'Rider'], required: true, index: true },
    entityId: { type: String, required: true, index: true },
    
    grossAmount: { type: Number, required: true, min: 0 },
    platformFees: { type: Number, required: true, min: 0 },
    taxes: { type: Number, required: true, min: 0 },
    netAmount: { type: Number, required: true, min: 0 },
    
    status: {
      type: String,
      enum: ['Pending', 'Processing', 'Paid', 'Failed', 'Cancelled'],
      default: 'Pending',
      index: true,
    },
    
    paidAt: { type: Date, default: null },
    notes: { type: String, default: '' },
    
    bankDetailsSnapshot: { type: mongoose.Schema.Types.Mixed }, // Snapshot of where funds were sent
  },
  { timestamps: true }
);

module.exports = mongoose.model('Settlement', settlementSchema);
