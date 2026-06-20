const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');

class AdminOnboardingAnalyticsService {
  async getVendorFunnel() {
    const funnel = await VendorKycRequest.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    return funnel;
  }

  async getRiderFunnel() {
    const funnel = await RiderKycRequest.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      }
    ]);
    return funnel;
  }

  async getApprovalTimes() {
    const computeForModel = async (Model, startAction, endAction) => {
      const result = await Model.aggregate([
        {
          $project: {
            startEntry: {
              $filter: {
                input: { $ifNull: ['$actionHistory', []] },
                as: 'item',
                cond: { $eq: ['$$item.action', startAction] }
              }
            },
            endEntry: {
              $filter: {
                input: { $ifNull: ['$actionHistory', []] },
                as: 'item',
                cond: { $eq: ['$$item.action', endAction] }
              }
            }
          }
        },
        {
          $match: {
            'startEntry.0': { $exists: true },
            'endEntry.0': { $exists: true }
          }
        },
        {
          $project: {
            timeDiffInMs: {
              $subtract: [
                { $toDate: { $arrayElemAt: ['$endEntry.timestamp', 0] } },
                { $toDate: { $arrayElemAt: ['$startEntry.timestamp', 0] } }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            averageMs: { $avg: '$timeDiffInMs' },
            minMs: { $min: '$timeDiffInMs' },
            maxMs: { $max: '$timeDiffInMs' },
            count: { $sum: 1 }
          }
        }
      ]);
      return result[0] || { averageMs: 0, minMs: 0, maxMs: 0, count: 0 };
    };

    const vendorApprovalTimes = await computeForModel(VendorKycRequest, 'submitted', 'approved');
    const riderApprovalTimes = await computeForModel(RiderKycRequest, 'applied', 'fleet_approval'); // using fleet_approval or active

    return {
      vendor: vendorApprovalTimes,
      rider: riderApprovalTimes
    };
  }

  async getDropoffs() {
    // A dropoff can be considered as an application that has been in a non-terminal state for a long time, or rejected
    const getDropoffStats = async (Model) => {
      return await Model.aggregate([
        {
          $match: {
            status: { $in: ['rejected', 'suspended'] }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);
    };
    const vendorDropoffs = await getDropoffStats(VendorKycRequest);
    const riderDropoffs = await getDropoffStats(RiderKycRequest);

    return { vendor: vendorDropoffs, rider: riderDropoffs };
  }

  async getAlerts() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Applications older than 7 days that are not in terminal states
    const terminalStates = ['approved', 'active', 'rejected', 'suspended'];
    
    const getBacklog = async (Model) => {
      return await Model.countDocuments({
        createdAt: { $lt: sevenDaysAgo },
        status: { $nin: terminalStates }
      });
    };

    const vendorBacklog = await getBacklog(VendorKycRequest);
    const riderBacklog = await getBacklog(RiderKycRequest);

    const getRejectionRate = async (Model) => {
      const stats = await Model.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            rejected: {
              $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
            }
          }
        }
      ]);
      if (!stats.length || stats[0].total === 0) return 0;
      return (stats[0].rejected / stats[0].total) * 100;
    };

    const vendorRejectionRate = await getRejectionRate(VendorKycRequest);
    const riderRejectionRate = await getRejectionRate(RiderKycRequest);

    const alerts = [];
    if (vendorBacklog > 10) alerts.push({ type: 'backlog', entity: 'vendor', count: vendorBacklog, message: `High backlog of vendor applications older than 7 days (${vendorBacklog})` });
    if (riderBacklog > 10) alerts.push({ type: 'backlog', entity: 'rider', count: riderBacklog, message: `High backlog of rider applications older than 7 days (${riderBacklog})` });
    
    if (vendorRejectionRate > 30) alerts.push({ type: 'rejection_rate', entity: 'vendor', rate: vendorRejectionRate, message: `High vendor rejection rate (${vendorRejectionRate.toFixed(2)}%)` });
    if (riderRejectionRate > 30) alerts.push({ type: 'rejection_rate', entity: 'rider', rate: riderRejectionRate, message: `High rider rejection rate (${riderRejectionRate.toFixed(2)}%)` });

    return alerts;
  }
}

module.exports = new AdminOnboardingAnalyticsService();
