const Campaign = require('../models/Campaign');

class CampaignService {
  async createCampaign(data) {
    const campaign = new Campaign(data);
    await campaign.save();
    return campaign;
  }

  async getCampaigns(vendorId) {
    return Campaign.find({ vendorId }).sort({ createdAt: -1 });
  }

  async updateCampaign(id, vendorId, data) {
    const campaign = await Campaign.findOneAndUpdate({ _id: id, vendorId }, data, { new: true });
    if (!campaign) throw new Error('Campaign not found');
    return campaign;
  }

  async updateStatus(id, vendorId, status) {
    const campaign = await Campaign.findOneAndUpdate({ _id: id, vendorId }, { status }, { new: true });
    if (!campaign) throw new Error('Campaign not found');
    return campaign;
  }

  async deleteCampaign(id, vendorId) {
    const result = await Campaign.deleteOne({ _id: id, vendorId });
    if (result.deletedCount === 0) throw new Error('Campaign not found');
    return { success: true };
  }
}

module.exports = new CampaignService();
