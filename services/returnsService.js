const ReturnRequest = require('../models/ReturnRequest');
const RefundRequest = require('../models/RefundRequest');
const ExchangeRequest = require('../models/ExchangeRequest');
const vendorNotificationService = require('./vendorNotificationService');

class ReturnsService {
  async getReturns(vendorId, options = {}) {
    const { page = 1, limit = 20, sort = { createdAt: -1 }, ...filters } = options;
    const skip = (page - 1) * limit;
    
    const query = { vendorId, ...filters };
    const [returns, total] = await Promise.all([
      ReturnRequest.find(query).sort(sort).skip(skip).limit(limit).lean(),
      ReturnRequest.countDocuments(query),
    ]);

    return {
      returns,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getRefunds(vendorId, options = {}) {
    const { page = 1, limit = 20, sort = { createdAt: -1 }, ...filters } = options;
    const skip = (page - 1) * limit;
    
    const query = { vendorId, ...filters };
    const [refunds, total] = await Promise.all([
      RefundRequest.find(query).sort(sort).skip(skip).limit(limit).lean(),
      RefundRequest.countDocuments(query),
    ]);

    return {
      refunds,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getExchanges(vendorId, options = {}) {
    const { page = 1, limit = 20, sort = { createdAt: -1 }, ...filters } = options;
    const skip = (page - 1) * limit;
    
    const query = { vendorId, ...filters };
    const [exchanges, total] = await Promise.all([
      ExchangeRequest.find(query).sort(sort).skip(skip).limit(limit).lean(),
      ExchangeRequest.countDocuments(query),
    ]);

    return {
      exchanges,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // --- Creation (usually by customer but exposed here) ---

  async createReturnRequest(data) {
    const req = await ReturnRequest.create(data);
    await vendorNotificationService.createNotification(req.vendorId, {
      title: req.returnType === 'trial_return' ? 'Trial Return Submitted' : 'Return Requested',
      message: `A new return request for order ${req.orderId} was submitted.`,
      type: 'return_requested',
      priority: 'high',
      entityId: req._id.toString(),
      entityType: 'ReturnRequest',
      targetRoute: '/vendor/returns',
    });
    return req;
  }

  async createRefundRequest(data) {
    const req = await RefundRequest.create(data);
    await vendorNotificationService.createNotification(req.vendorId, {
      title: 'Refund Requested',
      message: `A refund of \u20B9${req.amount} for order ${req.orderId} was requested.`,
      type: 'refund_requested',
      priority: 'high',
      entityId: req._id.toString(),
      entityType: 'RefundRequest',
      targetRoute: '/vendor/refunds',
    });
    return req;
  }

  async createExchangeRequest(data) {
    const req = await ExchangeRequest.create(data);
    await vendorNotificationService.createNotification(req.vendorId, {
      title: 'Exchange Requested',
      message: `An exchange for order ${req.orderId} was requested.`,
      type: 'exchange_requested',
      priority: 'high',
      entityId: req._id.toString(),
      entityType: 'ExchangeRequest',
      targetRoute: '/vendor/exchanges',
    });
    return req;
  }

  // --- State Updates ---

  async updateReturnStatus(requestId, vendorId, status) {
    const validStatuses = ['requested', 'approved', 'rejected', 'picked_up', 'received', 'inspected', 'closed'];
    if (!validStatuses.includes(status)) throw new Error('Invalid status');

    const req = await ReturnRequest.findOneAndUpdate(
      { _id: requestId, vendorId },
      { $set: { status } },
      { new: true }
    );
    if (!req) throw new Error('Return request not found');
    return req;
  }

  async updateRefundStatus(requestId, vendorId, status) {
    const validStatuses = ['requested', 'approved', 'processing', 'refunded', 'closed', 'rejected', 'pending'];
    if (!validStatuses.includes(status)) throw new Error('Invalid status');

    const req = await RefundRequest.findOneAndUpdate(
      { _id: requestId, vendorId },
      { $set: { status } },
      { new: true }
    );
    if (!req) throw new Error('Refund request not found');
    return req;
  }

  async updateExchangeStatus(requestId, vendorId, status) {
    const validStatuses = ['requested', 'approved', 'rejected', 'replacement_shipped', 'delivered', 'closed'];
    if (!validStatuses.includes(status)) throw new Error('Invalid status');

    const req = await ExchangeRequest.findOneAndUpdate(
      { _id: requestId, vendorId },
      { $set: { status } },
      { new: true }
    );
    if (!req) throw new Error('Exchange request not found');
    return req;
  }
}

module.exports = new ReturnsService();
