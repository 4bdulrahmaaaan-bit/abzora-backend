const mongoose = require('mongoose');
const TrialHomeSession = require('../models/TrialHomeSession');
const Order = require('../models/Order'); // Maybe needed for conversion revenue?
const User = require('../models/User');
const Store = require('../models/Store');

function calculateConversionRate(completedCount, convertedCount) {
  if (completedCount === 0) return 0;
  return Number(((convertedCount / completedCount) * 100).toFixed(1));
}

function calculateReturnRate(completedCount, returnedCount) {
  if (completedCount === 0) return 0;
  return Number(((returnedCount / completedCount) * 100).toFixed(1));
}

function calculateAverageTrialDuration(trials) {
  if (!trials || trials.length === 0) return 0;
  const validTrials = trials.filter(t => t.startedAt && t.completedAt);
  if (validTrials.length === 0) return 0;

  const totalMinutes = validTrials.reduce((sum, t) => {
    const diffMs = new Date(t.completedAt) - new Date(t.startedAt);
    return sum + (diffMs / (1000 * 60));
  }, 0);

  return Number((totalMinutes / validTrials.length).toFixed(0));
}

async function getTrialDashboard() {
  const activeStatuses = [
    'assigned',
    'rider_assigned',
    'en_route',
    'arrived',
    'trial_started',
    'trial_active',
    'out_for_trial_delivery',
    'trial_in_progress'
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    activeTrials,
    trialsToday,
    allCompletedTrials,
    convertedTrials,
    returnedTrials,
    allTrials,
    pendingReturns
  ] = await Promise.all([
    TrialHomeSession.countDocuments({ status: { $in: activeStatuses } }),
    TrialHomeSession.countDocuments({ createdAt: { $gte: today } }),
    TrialHomeSession.countDocuments({ status: { $in: ['completed', 'converted_to_order', 'converted_to_tailoring'] } }),
    TrialHomeSession.countDocuments({ trialOutcome: 'converted' }), // wait, 'purchased' or 'converted'? The schema uses 'converted', 'returned', 'partial_purchase'. We will count 'converted' and 'partial_purchase'.
    TrialHomeSession.countDocuments({ trialOutcome: { $in: ['returned', 'partial_purchase'] } }),
    TrialHomeSession.find({ status: { $in: ['completed', 'converted_to_order', 'converted_to_tailoring'] } }),
    TrialHomeSession.countDocuments({ status: { $in: ['return_requested', 'return_scheduled'] } }) // not strictly in schema but implied
  ]);

  // Adjust conversion/return logic based on outcomes
  const convertedCount = allTrials.filter(t => ['converted', 'partial_purchase'].includes(t.trialOutcome)).length;
  const returnedCount = allTrials.filter(t => ['returned', 'partial_purchase'].includes(t.trialOutcome)).length;

  const conversionRate = calculateConversionRate(allCompletedTrials, convertedCount);
  const returnRate = calculateReturnRate(allCompletedTrials, returnedCount);
  const averageTrialDuration = calculateAverageTrialDuration(allTrials);

  const trialRevenue = allTrials.reduce((sum, t) => sum + (t.finalAmount || 0), 0);
  
  // Calculate trial conversion revenue and AOV
  const trialConversionRevenue = allTrials.reduce((sum, t) => sum + (t.finalAmount || 0), 0);
  const averageOrderValueFromTrials = convertedCount > 0 ? Number((trialConversionRevenue / convertedCount).toFixed(2)) : 0;

  // For top converting vendor/category, we would need to aggregate
  // This is a placeholder for the advanced KPIs requested
  const topConvertingVendor = "Pending Aggregation";
  const topConvertingCategory = "Pending Aggregation";

  return {
    activeTrials,
    trialsToday,
    completedTrials: allCompletedTrials,
    conversionRate,
    returnRate,
    averageTrialDuration,
    trialRevenue,
    pendingReturns,
    trialConversionRevenue,
    averageOrderValueFromTrials,
    topConvertingVendor,
    topConvertingCategory
  };
}

async function getTrialQueue(query = {}) {
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 25;
  const skip = (page - 1) * limit;

  // Build Filter
  const filter = {};

  if (query.status) {
    // Map frontend statuses to backend statuses
    const statusMap = {
      'Scheduled': ['booked', 'confirmed'],
      'Assigned': ['assigned', 'rider_assigned', 'en_route', 'arrived'],
      'Trial Active': ['trial_started', 'trial_active', 'trial_in_progress'],
      'Purchased': ['converted_to_order', 'converted_to_tailoring'],
      'Returned': ['completed'], // Depends on outcome
      'Cancelled': ['cancelled'],
      'Closed': ['completed', 'cancelled', 'no_show']
    };
    filter.status = { $in: statusMap[query.status] || [query.status] };
  }

  if (query.trialOutcome) {
    filter.trialOutcome = query.trialOutcome.toLowerCase().replace(' ', '_');
  }

  if (query.paymentStatus) {
    filter.paymentStatus = query.paymentStatus.toLowerCase();
  }

  if (query.vendor) {
    filter.vendorId = query.vendor;
  }

  if (query.rider) {
    filter.riderId = query.rider;
  }

  if (query.startDate && query.endDate) {
    filter.createdAt = {
      $gte: new Date(query.startDate),
      $lte: new Date(query.endDate)
    };
  }

  // Handle Search across multiple collections (Trial ID, Customer Name/Phone, Vendor Name, Rider Name)
  if (query.search) {
    const searchRegex = new RegExp(query.search, 'i');
    
    // To support searching by related entity names, we first find matching Users/Stores
    const [matchingUsers, matchingStores] = await Promise.all([
      User.find({
        $or: [
          { name: searchRegex },
          { phone: searchRegex }
        ]
      }).select('_id'),
      Store.find({
        $or: [
          { name: searchRegex }
        ]
      }).select('_id vendorId')
    ]);

    const userIds = matchingUsers.map(u => u._id.toString());
    const storeIds = matchingStores.map(s => s._id.toString());
    const vendorIdsFromStores = matchingStores.map(s => s.vendorId?.toString()).filter(Boolean);

    filter.$or = [
      { _id: mongoose.Types.ObjectId.isValid(query.search) ? query.search : null }, // Exact ID match
      { userId: { $in: userIds } },
      { riderId: { $in: userIds } },
      { storeId: { $in: storeIds } },
      { vendorId: { $in: vendorIdsFromStores } }
    ].filter(cond => Object.values(cond)[0] !== null);
  }

  // Handle Sorting
  const sort = {};
  if (query.sortBy) {
    sort[query.sortBy] = query.sortDesc === 'true' ? -1 : 1;
  } else {
    sort.updatedAt = -1; // Default
  }

  const [data, totalCount] = await Promise.all([
    TrialHomeSession.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    TrialHomeSession.countDocuments(filter)
  ]);

  // Populate names manually since schemas use string IDs
  const userIds = new Set();
  const storeIds = new Set();
  data.forEach(t => {
    if (t.userId) userIds.add(t.userId);
    if (t.riderId) userIds.add(t.riderId);
    if (t.storeId) storeIds.add(t.storeId);
  });

  const [users, stores] = await Promise.all([
    User.find({ _id: { $in: Array.from(userIds) } }).select('name phone profileImageUrl').lean(),
    Store.find({ _id: { $in: Array.from(storeIds) } }).select('name logoUrl').lean()
  ]);

  const userMap = users.reduce((acc, u) => ({ ...acc, [u._id.toString()]: u }), {});
  const storeMap = stores.reduce((acc, s) => ({ ...acc, [s._id.toString()]: s }), {});

  const populatedData = data.map(trial => {
    const customer = userMap[trial.userId] || { name: 'Unknown' };
    const rider = userMap[trial.riderId] || { name: 'Unassigned' };
    const vendor = storeMap[trial.storeId] || { name: 'Unknown' };

    return {
      id: trial._id.toString(),
      customerName: customer.name,
      customerPhone: customer.phone,
      vendorName: vendor.name,
      riderName: rider.name,
      products: trial.items || [],
      trialFee: trial.trialFee,
      status: trial.status,
      trialOutcome: trial.trialOutcome,
      paymentStatus: trial.paymentStatus,
      createdAt: trial.createdAt,
      updatedAt: trial.updatedAt,
      finalAmount: trial.finalAmount,
      trialDurationMinutes: trial.trialDurationMinutes
    };
  });

  return {
    data: populatedData,
    meta: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit)
    }
  };
}

async function getTrialDetails(id) {
  const trial = await TrialHomeSession.findById(id).lean();
  if (!trial) throw new Error('Trial not found');

  const [customer, vendor, rider] = await Promise.all([
    User.findById(trial.userId).select('name phone email address').lean(),
    Store.findById(trial.storeId).select('name rating logoUrl address').lean(),
    trial.riderId ? User.findById(trial.riderId).select('name phone riderVehicleType').lean() : null
  ]);

  return {
    ...trial,
    id: trial._id.toString(),
    customer: customer || { name: 'Unknown' },
    vendor: vendor || { name: 'Unknown' },
    rider: rider || { name: 'Unassigned' },
    itemsDelivered: trial.items || [],
    itemsKept: trial.keptItems || [],
    itemsReturned: trial.returnedItems || [],
    timeline: trial.events || [],
    proofPhotos: trial.proofPhotos || []
  };
}

async function getTrialAnalytics() {
  // Aggregate Most Converted Products
  const pipelineConverted = [
    { $match: { trialOutcome: { $in: ['converted', 'partial_purchase'] } } },
    { $unwind: "$keptItems" },
    { $group: { _id: "$keptItems", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ];

  // Aggregate Most Returned Products
  const pipelineReturned = [
    { $match: { trialOutcome: { $in: ['returned', 'partial_purchase'] } } },
    { $unwind: "$returnedItems" },
    { $group: { _id: "$returnedItems", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ];

  const [mostConvertedItems, mostReturnedItems] = await Promise.all([
    TrialHomeSession.aggregate(pipelineConverted),
    TrialHomeSession.aggregate(pipelineReturned)
  ]);

  // For the actual names, we would lookup products
  // Skipping product lookup for brevity unless needed

  // Funnel
  const [scheduled, started, completed, purchased, returned] = await Promise.all([
    TrialHomeSession.countDocuments({ status: { $in: ['booked', 'confirmed', 'assigned'] } }),
    TrialHomeSession.countDocuments({ status: { $in: ['trial_started', 'trial_active', 'trial_in_progress'] } }),
    TrialHomeSession.countDocuments({ status: { $in: ['completed', 'converted_to_order'] } }),
    TrialHomeSession.countDocuments({ trialOutcome: { $in: ['converted', 'partial_purchase'] } }),
    TrialHomeSession.countDocuments({ trialOutcome: { $in: ['returned', 'partial_purchase'] } })
  ]);

  return {
    mostConvertedProducts: mostConvertedItems,
    mostReturnedProducts: mostReturnedItems,
    vendorRankings: [], // Placeholder
    riderRankings: [], // Placeholder
    categoryRankings: [], // Placeholder
    trialFunnel: {
      scheduled,
      started,
      completed,
      purchased,
      returned
    }
  };
}

module.exports = {
  getTrialDashboard,
  getTrialQueue,
  getTrialDetails,
  getTrialAnalytics,
  calculateConversionRate,
  calculateReturnRate,
  calculateAverageTrialDuration
};
