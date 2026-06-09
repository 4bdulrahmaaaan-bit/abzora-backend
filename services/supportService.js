const SupportTicket = require('../models/SupportTicket');
const TicketMessage = require('../models/TicketMessage');
const vendorNotificationService = require('./vendorNotificationService');
const crypto = require('crypto');

class SupportService {
  async getTickets(vendorId, options = {}) {
    const { page = 1, limit = 20, sort = { createdAt: -1 }, ...filters } = options;
    const skip = (page - 1) * limit;

    const query = { vendorId, ...filters };
    const [tickets, total] = await Promise.all([
      SupportTicket.find(query).sort(sort).skip(skip).limit(limit).lean(),
      SupportTicket.countDocuments(query),
    ]);

    return {
      tickets,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getTicketWithMessages(ticketId, vendorId) {
    const ticket = await SupportTicket.findOne({ ticketId, vendorId }).lean();
    if (!ticket) throw new Error('Ticket not found');

    const messages = await TicketMessage.find({ ticketId: ticket._id }).sort({ createdAt: 1 }).lean();
    return { ticket, messages };
  }

  async createTicket(vendorId, data) {
    // Generate a unique ticket ID like TKT-XYZ123
    const customTicketId = 'TKT-' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const ticket = await SupportTicket.create({
      ...data,
      ticketId: customTicketId,
      vendorId,
      status: 'open',
    });

    await vendorNotificationService.createNotification(vendorId, {
      title: 'Ticket Created',
      message: `Support ticket ${customTicketId} has been created successfully.`,
      type: 'ticket_created',
      priority: 'normal',
      entityId: ticket.ticketId,
      entityType: 'SupportTicket',
      targetRoute: '/vendor/support',
    });

    return ticket;
  }

  async addMessage(ticketId, senderId, senderType, messageData) {
    const ticket = await SupportTicket.findOne({ ticketId });
    if (!ticket) throw new Error('Ticket not found');

    // Add message
    const message = await TicketMessage.create({
      ticketId: ticket._id,
      senderId,
      senderType,
      message: messageData.message,
      attachments: messageData.attachments || [],
    });

    // Automatically update status to open if vendor replies, or pending if support replies
    if (senderType === 'vendor' && ticket.status !== 'open') {
      ticket.status = 'open';
      await ticket.save();
    } else if (senderType !== 'vendor' && ticket.status === 'open') {
      ticket.status = 'pending';
      await ticket.save();
    }

    if (senderType !== 'vendor') {
      await vendorNotificationService.createNotification(ticket.vendorId, {
        title: 'Ticket Updated',
        message: `You have a new reply on ticket ${ticket.ticketId}.`,
        type: 'ticket_updated',
        priority: 'high',
        entityId: ticket.ticketId,
        entityType: 'SupportTicket',
        targetRoute: '/vendor/support',
      });
    }

    return message;
  }

  async updateTicketStatus(ticketId, vendorId, status) {
    const validStatuses = ['open', 'pending', 'resolved', 'closed'];
    if (!validStatuses.includes(status)) throw new Error('Invalid status');

    const ticket = await SupportTicket.findOneAndUpdate(
      { ticketId, vendorId },
      { $set: { status } },
      { new: true }
    );
    if (!ticket) throw new Error('Ticket not found');

    if (status === 'resolved' || status === 'closed') {
      await vendorNotificationService.createNotification(vendorId, {
        title: 'Ticket Resolved',
        message: `Ticket ${ticketId} has been marked as ${status}.`,
        type: 'ticket_resolved',
        priority: 'normal',
        entityId: ticket.ticketId,
        entityType: 'SupportTicket',
        targetRoute: '/vendor/support',
      });
    }

    return ticket;
  }
}

module.exports = new SupportService();
