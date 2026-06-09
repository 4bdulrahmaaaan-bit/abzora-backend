const SupportTicket = require('../models/SupportTicket');

class SupportAnalyticsService {
  async getAnalytics(vendorId) {
    const tickets = await SupportTicket.find({ vendorId }).lean();

    const total = tickets.length;
    const open = tickets.filter((t) => t.status === 'open' || t.status === 'pending').length;
    const resolved = tickets.filter((t) => t.status === 'resolved' || t.status === 'closed').length;
    const critical = tickets.filter((t) => t.priority === 'critical').length;

    let resolutionRate = 0;
    if (total > 0) {
      resolutionRate = (resolved / total) * 100;
    }

    // Average Resolution Time (approximation using createdAt and updatedAt for resolved tickets)
    let totalResolutionTimeMs = 0;
    let resolvedWithTimeCount = 0;

    tickets.forEach((t) => {
      if (t.status === 'resolved' || t.status === 'closed') {
        const created = new Date(t.createdAt).getTime();
        const updated = new Date(t.updatedAt).getTime();
        if (updated >= created) {
          totalResolutionTimeMs += updated - created;
          resolvedWithTimeCount++;
        }
      }
    });

    let avgResolutionTimeHours = 0;
    if (resolvedWithTimeCount > 0) {
      avgResolutionTimeHours = totalResolutionTimeMs / resolvedWithTimeCount / (1000 * 60 * 60);
    }

    return {
      totalTickets: total,
      openTickets: open,
      resolvedTickets: resolved,
      criticalTickets: critical,
      resolutionRate,
      avgResolutionTimeHours,
    };
  }
}

module.exports = new SupportAnalyticsService();
