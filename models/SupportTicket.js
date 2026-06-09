const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    ticketId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    vendorId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ['technical', 'payout', 'orders', 'returns', 'kyc', 'store', 'marketing', 'other'],
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'critical'],
      default: 'normal',
    },
    status: {
      type: String,
      enum: ['open', 'pending', 'resolved', 'closed'],
      default: 'open',
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    attachments: {
      type: [String],
      default: () => [],
    },
  },
  {
    timestamps: true,
    collection: 'support_tickets',
  }
);

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
