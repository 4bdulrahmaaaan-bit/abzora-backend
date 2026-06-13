const cron = require('node-cron');
const User = require('../models/User');
const VendorKycRequest = require('../models/VendorKycRequest');
const RiderKycRequest = require('../models/RiderKycRequest');
const Product = require('../models/Product');

function runOnboardingAutomations() {
  console.log('[Onboarding Automations] Starting cron jobs...');

  // Job 1: Remind incomplete onboarding > 24h (Vendor & Rider)
  cron.schedule('0 10 * * *', async () => {
    console.log('[Cron] Running Job 1: Incomplete onboarding > 24h reminder');
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const vendors = await User.find({ role: 'vendor', createdAt: { $lt: yesterday } }).lean();
      
      for (const vendor of vendors) {
        const kyc = await VendorKycRequest.findOne({ userId: vendor.uid });
        if (!kyc) {
          console.log(`[Notification] Reminder sent to vendor ${vendor.uid}: Please submit your KYC to start selling!`);
        }
      }

      const riders = await User.find({ role: 'rider', createdAt: { $lt: yesterday } }).lean();
      for (const rider of riders) {
        const kyc = await RiderKycRequest.findOne({ userId: rider.uid });
        if (!kyc) {
          console.log(`[Notification] Reminder sent to rider ${rider.uid}: Please submit your KYC to start delivering!`);
        }
      }
    } catch (err) {
      console.error('[Job 1 Error]', err);
    }
  });

  // Job 2: Escalate incomplete > 7 days
  cron.schedule('0 11 * * *', async () => {
    console.log('[Cron] Running Job 2: Escalate incomplete > 7 days');
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const vendors = await User.find({ role: 'vendor', createdAt: { $lt: sevenDaysAgo } }).lean();
      
      for (const vendor of vendors) {
        const kyc = await VendorKycRequest.findOne({ userId: vendor.uid });
        if (!kyc) {
          console.log(`[Escalation] Admin notified: Vendor ${vendor.uid} hasn't completed onboarding for 7 days.`);
        }
      }
      
      const riders = await User.find({ role: 'rider', createdAt: { $lt: sevenDaysAgo } }).lean();
      for (const rider of riders) {
        const kyc = await RiderKycRequest.findOne({ userId: rider.uid });
        if (!kyc) {
          console.log(`[Escalation] Admin notified: Rider ${rider.uid} hasn't completed onboarding for 7 days.`);
        }
      }
    } catch (err) {
      console.error('[Job 2 Error]', err);
    }
  });

  // Job 3: Vendor active with 0 products reminder
  cron.schedule('0 12 * * *', async () => {
    console.log('[Cron] Running Job 3: Vendor active with 0 products reminder');
    try {
      const activeVendors = await VendorKycRequest.find({ status: 'active' }).lean();
      for (const vendor of activeVendors) {
        const productCount = await Product.countDocuments({ vendorId: vendor.userId });
        if (productCount === 0) {
          console.log(`[Notification] Reminder sent to active vendor ${vendor.userId}: You have 0 products. Please add products to your store!`);
        }
      }
    } catch (err) {
      console.error('[Job 3 Error]', err);
    }
  });

  // Job 4: Rider training pending > 24h reminder
  cron.schedule('0 13 * * *', async () => {
    console.log('[Cron] Running Job 4: Rider training pending > 24h reminder');
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const pendingRiders = await RiderKycRequest.find({
        status: 'training_pending',
        'training.status': 'pending',
        updatedAt: { $lt: yesterday }
      }).lean();

      for (const rider of pendingRiders) {
        console.log(`[Notification] Reminder sent to rider ${rider.userId}: Please complete your pending training module!`);
      }
    } catch (err) {
      console.error('[Job 4 Error]', err);
    }
  });
}

module.exports = runOnboardingAutomations;

if (require.main === module) {
  runOnboardingAutomations();
}
