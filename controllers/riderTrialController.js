const TrialHomeSession = require('../models/TrialHomeSession');
const Order = require('../models/Order');
const User = require('../models/User'); 
const mongoose = require('mongoose');

// Mock telemetry / notification imports since specific implementations aren't provided but required by instructions
const telemetry = require('../services/telemetryContext'); 
const riderEarningsService = require('../services/riderEarningsService');
const riderPerformanceService = require('../services/riderPerformanceService');

// Helper for notifications
async function triggerNotifications(event, session) {
  // In a real app, this sends pushes to Customer, Vendor, and Admin
  console.log(`[NOTIFICATION] Event: ${event}, Trial: ${session._id}`);
}

// Helper for analytics exactly once
async function emitTrialEvent(event, session) {
  if (!session.events) session.events = [];
  const eventExists = session.events.some(e => e.type === event);
  if (!eventExists) {
    session.events.push({ type: event, timestamp: new Date() });
    console.log(`[ANALYTICS] Emitted exactly-once event: ${event} for Trial: ${session._id}`);
  }
}

function nowIso() {
  return new Date().toISOString();
}

async function getAssignedTrials(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const trials = await TrialHomeSession.find({
      riderId,
      status: 'assigned',
    }).sort({ scheduledAt: 1 }).lean();
    return res.status(200).json({ success: true, data: trials, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

async function getActiveTrials(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const trials = await TrialHomeSession.find({
      riderId,
      status: { $in: ['en_route', 'arrived', 'trial_started', 'trial_active', 'trial_in_progress', 'out_for_trial_delivery'] },
    }).sort({ updatedAt: -1 }).lean();
    return res.status(200).json({ success: true, data: trials, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

async function getCompletedTrials(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const trials = await TrialHomeSession.find({
      riderId,
      status: { $in: ['completed', 'cancelled', 'no_show'] },
    }).sort({ completedAt: -1, updatedAt: -1 }).limit(50).lean();
    return res.status(200).json({ success: true, data: trials, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

async function arriveTrial(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const { id } = req.params;
    
    const session = await TrialHomeSession.findOne({ _id: id, riderId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial session not found.' });
    }
    
    // State Machine Guard
    if (session.status !== 'assigned' && session.status !== 'en_route' && session.status !== 'out_for_trial_delivery') {
      return res.status(400).json({ success: false, message: 'Invalid state transition to arrived.' });
    }
    
    session.status = 'arrived';
    session.arrivedAt = new Date();
    await session.save();

    return res.status(200).json({ success: true, data: session, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

async function startTrial(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const { id } = req.params;
    
    const session = await TrialHomeSession.findOne({ _id: id, riderId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial session not found.' });
    }
    
    // State Machine Guard
    if (session.status !== 'arrived') {
      return res.status(400).json({ success: false, message: 'Invalid state transition to started. Must be arrived.' });
    }
    
    session.status = 'trial_started';
    session.startedAt = new Date();
    session.customerAcknowledged = true; 
    session.customerAcknowledgedAt = new Date();
    
    await emitTrialEvent('Trial Started', session);
    await triggerNotifications('Trial Started', session);
    
    await session.save();

    return res.status(200).json({ success: true, data: session, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

async function calculateCheckout(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const { id } = req.params;
    const { itemsKept = [], itemsReturned = [] } = req.body;
    
    if (!Array.isArray(itemsKept) || !Array.isArray(itemsReturned)) {
      return res.status(400).json({ success: false, message: 'Invalid payload format.' });
    }

    const session = await TrialHomeSession.findOne({ _id: id, riderId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial session not found.' });
    }
    
    let subtotal = 0;
    const keptItemIds = new Set(itemsKept);
    
    for (const item of session.items) {
      if (keptItemIds.has(item.productId.toString())) {
        subtotal += Number(item.price || 0);
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      data: {
        subtotal,
        finalAmount: subtotal,
        itemsKept,
        itemsReturned
      },
      serverTime: nowIso()
    });
  } catch (error) {
    next(error);
  }
}

async function completeTrial(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const { id } = req.params;
    const { 
      itemsKept = [], 
      itemsReturned = [], 
      trialOutcome, 
      notes,
      paymentMethod,
      paymentCollected,
      proofPhotos = []
    } = req.body;
    
    // Basic Request Validation
    if (!Array.isArray(itemsKept) || !Array.isArray(itemsReturned) || !Array.isArray(proofPhotos)) {
      return res.status(400).json({ success: false, message: 'Invalid payload format.' });
    }
    
    const session = await TrialHomeSession.findOne({ _id: id, riderId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial session not found.' });
    }
    
    // State Machine Guard
    if (session.status !== 'trial_started' && session.status !== 'trial_active' && session.status !== 'trial_in_progress') {
      return res.status(400).json({ success: false, message: 'Invalid state transition to completed.' });
    }

    // Inventory Consistency Validation
    if (itemsKept.length + itemsReturned.length !== session.items.length) {
      return res.status(400).json({ success: false, message: 'Inventory consistency check failed. All items must be accounted for.' });
    }

    // Proof Photo Enforcement
    if (['returned', 'partial_purchase', 'damaged'].includes(trialOutcome)) {
      if (proofPhotos.length === 0) {
        return res.status(400).json({ success: false, message: 'Proof photos are mandatory for this trial outcome.' });
      }
    }
    
    let subtotal = 0;
    const keptItemIds = new Set(itemsKept);
    for (const item of session.items) {
      if (keptItemIds.has(item.productId.toString())) {
        subtotal += Number(item.price || 0);
      }
    }
    
    // Payment Enforcement
    if (subtotal > 0 && paymentMethod !== 'Cash') {
      if (session.paymentStatus !== 'captured') {
        return res.status(400).json({ success: false, message: 'Trial completion blocked: Digital payment not captured.' });
      }
    }

    session.status = 'completed';
    session.completedAt = new Date();
    session.itemsKept = itemsKept;
    session.itemsReturned = itemsReturned;
    session.trialOutcome = trialOutcome;
    session.notes = notes;
    session.finalAmount = subtotal;
    session.paymentMethod = paymentMethod;
    session.proofPhotos = proofPhotos;
    
    if (paymentMethod === 'Cash' && paymentCollected) {
      session.paymentStatus = 'captured';
      session.paymentCollected = true;
      session.paymentCollectedAt = new Date();
    }
    
    // Analytics exactly once
    await emitTrialEvent('Trial Completed', session);
    if (subtotal > 0 && session.paymentStatus === 'captured') {
      await emitTrialEvent('Payment Captured', session);
    }
    if (itemsKept.length > 0) {
      session.converted = true;
      await emitTrialEvent('Trial Converted', session);
    }
    if (itemsReturned.length > 0) {
      session.returnObserved = true;
      await emitTrialEvent('Trial Returned', session);
    }

    await triggerNotifications('Trial Completed', session);

    await session.save();

    // Hook: Earnings & Performance
    await riderEarningsService.logEarnings({
      riderId,
      earningType: 'trial_completion',
      amount: 50, // Base trial completion earning
      trialSessionId: session._id.toString(),
      notes: 'Completed trial session',
      status: 'pending'
    });

    if (itemsKept.length > 0) {
      await riderEarningsService.logEarnings({
        riderId,
        earningType: 'trial_conversion_bonus',
        amount: 20, // Conversion bonus
        trialSessionId: session._id.toString(),
        notes: 'Bonus for trial conversion',
        status: 'pending'
      });
    }

    await riderPerformanceService.calculateAndSavePerformance(riderId);

    return res.status(200).json({ success: true, data: session, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

async function noShowTrial(req, res, next) {
  try {
    const riderId = req.user._id.toString();
    const { id } = req.params;
    const { notes, proofPhotos = [] } = req.body;
    
    if (!Array.isArray(proofPhotos)) {
      return res.status(400).json({ success: false, message: 'Invalid payload format.' });
    }

    const session = await TrialHomeSession.findOne({ _id: id, riderId });
    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial session not found.' });
    }
    
    // State Machine Guard
    if (session.status !== 'arrived') {
      return res.status(400).json({ success: false, message: 'Invalid state transition to no_show. Must be arrived.' });
    }

    session.status = 'no_show';
    session.completedAt = new Date();
    session.trialOutcome = 'cancelled';
    session.notes = notes;
    session.proofPhotos = proofPhotos;
    
    await emitTrialEvent('No Show', session);
    await triggerNotifications('No Show', session);
    
    await session.save();

    // Hook: Performance recalculation
    await riderPerformanceService.calculateAndSavePerformance(riderId);

    return res.status(200).json({ success: true, data: session, serverTime: nowIso() });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getAssignedTrials,
  getActiveTrials,
  getCompletedTrials,
  arriveTrial,
  startTrial,
  calculateCheckout,
  completeTrial,
  noShowTrial
};
