const User = require('../models/User');

class AdminRiderAnalyticsService {
  async getDashboardKPIs() {
    // Aggregating rider data. In a real app we'd aggregate their assigned orders & trials.
    // For now we'll do a basic count and mock complex KPIs based on requirements.
    const [stats] = await User.aggregate([
      { $match: { role: 'rider' } },
      {
        $group: {
          _id: null,
          totalRiders: { $sum: 1 },
          activeRiders: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
        }
      }
    ]);

    const total = stats?.totalRiders || 0;
    const active = stats?.activeRiders || 0;
    
    // Complex metrics mocked as requested by UI KPIs, derived from real models where possible
    const riderHealthScore = 84; // Mocked
    const riderRiskScore = 12; // Mocked

    let classification = 'Healthy';
    if (riderRiskScore > 40) classification = 'Critical';
    else if (riderRiskScore > 20) classification = 'Warning';

    return {
      totalRiders: total,
      activeRiders: active,
      riderHealthScore,
      riderRiskScore,
      avgEarningsTrend: '₹4,500/wk',
      avgTrialPerformance: '92%',
      avgDeliveryPerformance: '98%',
      slaPerformance: '95%',
      complaintRate: '1.2%',
      overallClassification: classification,
    };
  }

  async getClassifiedRiders(classification) {
    // In reality this would be a complex scoring pipeline.
    // We'll return a filtered list based on simple mock logic.
    const limit = 50;
    const riders = await User.find({ role: 'rider' }).limit(limit).select('name phone status vehicleInfo kycStatus').lean();

    // Map a mock risk score to each rider to satisfy the UI
    return riders.map(r => {
      const mockScore = Math.floor(Math.random() * 100);
      let classif = 'Healthy';
      if (mockScore > 80) classif = 'Critical';
      else if (mockScore > 60) classif = 'Warning';

      return {
        ...r,
        riskScore: mockScore,
        healthScore: 100 - mockScore,
        classification: classif,
        earnings: Math.floor(Math.random() * 20000),
      };
    }).filter(r => !classification || r.classification === classification);
  }
}

module.exports = new AdminRiderAnalyticsService();
