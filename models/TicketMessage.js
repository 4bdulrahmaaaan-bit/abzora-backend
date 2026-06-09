const mongoose = require('mongoose');

const ticketMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    senderId: {
      type: String,
      required: true,
      index: true,
    },
    senderType: {
      type: String,
      enum: ['vendor', 'admin', 'support'],
      required: true,
    },
    message: {
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
    collection: 'ticket_messages',
  }
);

module.exports = mongoose.model('TicketMessage', ticketMessageSchema);
