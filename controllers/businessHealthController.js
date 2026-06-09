const businessHealthService = require('../services/businessHealthService');

class BusinessHealthController {
  async getHealth(req, res) {
    try {
      const vendorId = req.vendor.id;
      const data = await businessHealthService.getHealthScore(vendorId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }

  // Force recalculation for testing or webhook triggers
  async recalculateHealth(req, res) {
    try {
      const vendorId = req.vendor.id;
      const data = await businessHealthService.recalculateHealth(vendorId);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, message: error.message });
    }
  }
}

module.exports = new BusinessHealthController();
