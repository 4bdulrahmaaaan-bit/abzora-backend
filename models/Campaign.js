const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema(
  {
    vendorId: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    bannerImage: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['draft', 'scheduled', 'active', 'completed', 'cancelled'], default: 'draft' },
    budget: { type: Number, required: true, min: 0 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Campaign', campaignSchema);
