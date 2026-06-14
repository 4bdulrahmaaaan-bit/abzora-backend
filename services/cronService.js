const cron = require('node-cron');
const VendorOnboardingDraft = require('../models/VendorOnboardingDraft');
const RiderOnboardingDraft = require('../models/RiderOnboardingDraft');

/**
 * Initialize all scheduled background jobs
 */
exports.initializeCronJobs = () => {
  console.log('Initializing cron jobs...');

  // Cleanup Vendor Drafts (Daily at 2:00 AM)
  cron.schedule('0 2 * * *', async () => {
    try {
      console.log('[CRON] Starting cleanupVendorDrafts job...');
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await VendorOnboardingDraft.deleteMany({
        updatedAt: { $lt: thirtyDaysAgo },
        draftStatus: { $in: ['draft', 'migrated'] } // Keep submitted/abandoned if needed, or delete all older than 30 days. Let's delete all as per req
      });

      console.log(`[CRON] cleanupVendorDrafts completed. Deleted ${result.deletedCount} old drafts.`);
    } catch (error) {
      console.error('[CRON] Error in cleanupVendorDrafts:', error);
    }
  });

  // Cleanup Rider Drafts (Daily at 2:30 AM)
  cron.schedule('30 2 * * *', async () => {
    try {
      console.log('[CRON] Starting cleanupRiderDrafts job...');
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const result = await RiderOnboardingDraft.deleteMany({
        updatedAt: { $lt: thirtyDaysAgo },
        draftStatus: { $in: ['draft', 'migrated'] }
      });

      console.log(`[CRON] cleanupRiderDrafts completed. Deleted ${result.deletedCount} old drafts.`);
    } catch (error) {
      console.error('[CRON] Error in cleanupRiderDrafts:', error);
    }
  });

  // Future Jobs placeholder
  // Settlement processing
  // Notification cleanup
  // Analytics aggregation
  // Abandoned onboarding reporting
};
