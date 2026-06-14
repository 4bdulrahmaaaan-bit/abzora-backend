const VendorOnboardingDraft = require('../models/VendorOnboardingDraft');

/**
 * Upsert draft by userId
 */
exports.saveDraft = async (req, res) => {
  try {
    const { userId } = req.user; // Assuming req.user is set by authMiddleware
    const draftData = req.body;
    
    // Ensure we don't accidentally override the draftStatus if it's not provided,
    // but if the draft is currently submitted/abandoned, we might want to reset it to draft
    const updatePayload = {
      ...draftData,
      lastSavedAt: new Date(),
    };

    const draft = await VendorOnboardingDraft.findOneAndUpdate(
      { userId },
      { $set: updatePayload },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: draft });
  } catch (error) {
    console.error('Error saving vendor onboarding draft:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Fetch draft by userId
 */
exports.getDraft = async (req, res) => {
  try {
    const { userId } = req.user;
    
    const draft = await VendorOnboardingDraft.findOne({ userId });
    
    if (!draft) {
      return res.status(404).json({ success: false, message: 'Draft not found' });
    }

    // Update lastOpenedAt
    draft.lastOpenedAt = new Date();
    await draft.save();

    res.status(200).json({ success: true, data: draft });
  } catch (error) {
    console.error('Error getting vendor onboarding draft:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Delete draft by userId
 */
exports.deleteDraft = async (req, res) => {
  try {
    const { userId } = req.user;
    await VendorOnboardingDraft.findOneAndDelete({ userId });
    
    res.status(200).json({ success: true, message: 'Draft deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor onboarding draft:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Update currentStep only
 */
exports.updateStep = async (req, res) => {
  try {
    const { userId } = req.user;
    const { currentStep } = req.body;
    
    if (currentStep === undefined) {
      return res.status(400).json({ success: false, message: 'currentStep is required' });
    }

    const draft = await VendorOnboardingDraft.findOneAndUpdate(
      { userId },
      { $set: { currentStep, lastSavedAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, data: draft });
  } catch (error) {
    console.error('Error updating vendor onboarding step:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

/**
 * Admin: Get all drafts
 */
exports.adminGetDrafts = async (req, res) => {
  try {
    const drafts = await VendorOnboardingDraft.find()
      .select('userId currentStep draftStatus updatedAt startedAt')
      .sort({ updatedAt: -1 })
      .lean();
      
    res.status(200).json({ success: true, data: drafts });
  } catch (error) {
    console.error('Error fetching admin vendor drafts:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
