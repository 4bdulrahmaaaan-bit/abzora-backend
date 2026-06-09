const campaignService = require('../services/campaignService');

exports.createCampaign = async (req, res) => {
  try {
    const data = { ...req.body, vendorId: req.user.id };
    const campaign = await campaignService.createCampaign(data);
    res.status(201).json(campaign);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.getCampaigns = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const campaigns = await campaignService.getCampaigns(vendorId);
    res.json({ campaigns });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

exports.updateCampaign = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const campaign = await campaignService.updateCampaign(id, vendorId, req.body);
    res.json(campaign);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.updateStatus = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const { status } = req.body;
    const campaign = await campaignService.updateStatus(id, vendorId, status);
    res.json(campaign);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

exports.deleteCampaign = async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { id } = req.params;
    const result = await campaignService.deleteCampaign(id, vendorId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};
