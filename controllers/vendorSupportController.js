const supportService = require('../services/supportService');
const supportAnalyticsService = require('../services/supportAnalyticsService');

class VendorSupportController {
  async getTickets(req, res) {
    try {
      const vendorId = req.vendor.id;
      const options = {
        page: parseInt(req.query.page) || 1,
        limit: parseInt(req.query.limit) || 20,
      };

      if (req.query.status) options.status = req.query.status;

      const data = await supportService.getTickets(vendorId, options);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getTicket(req, res) {
    try {
      const vendorId = req.vendor.id;
      const { id } = req.params;
      const data = await supportService.getTicketWithMessages(id, vendorId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(404).json({ success: false, message: error.message });
    }
  }

  async createTicket(req, res) {
    try {
      const vendorId = req.vendor.id;
      const ticket = await supportService.createTicket(vendorId, req.body);
      res.status(201).json({ success: true, data: ticket });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async addMessage(req, res) {
    try {
      const vendorId = req.vendor.id;
      const { id } = req.params;
      const message = await supportService.addMessage(id, vendorId, 'vendor', req.body);
      res.status(201).json({ success: true, data: message });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async updateTicketStatus(req, res) {
    try {
      const vendorId = req.vendor.id;
      const { id } = req.params;
      const { status } = req.body;
      const ticket = await supportService.updateTicketStatus(id, vendorId, status);
      res.json({ success: true, data: ticket });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  async getAnalytics(req, res) {
    try {
      const vendorId = req.vendor.id;
      const data = await supportAnalyticsService.getAnalytics(vendorId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new VendorSupportController();
