const ExperienceControl = require('../models/ExperienceControl');
const ExperienceLog = require('../models/ExperienceLog');
const { decideAction, updateReward } = require('../services/mlBanditService');

function rewardFromEvent(eventType) {
  const event = String(eventType || '').trim().toLowerCase();
  if (event === 'purchase') return 1;
  if (event === 'trial_conversion') return 0.7;
  return 0;
}

async function getMlDecision(req, res, next) {
  try {
    const features = {
      fitConfidence: req.query?.fitConfidence,
      returnRate: req.query?.returnRate ?? req.query?.returnHistory,
      sessionDepth: req.query?.sessionDepth,
      sameDayAvailable: req.query?.sameDayAvailable,
      productFitRisk: req.query?.productFitRisk,
      userType: req.query?.userType,
    };

    const control = await ExperienceControl.findOne({ key: 'default' }).lean();
    const epsilon = control?.ml?.epsilon ?? 0.15;
    const decision = await decideAction({
      features,
      epsilon,
      seed: `${req.query?.userId || ''}:${req.query?.productId || ''}:${Date.now()}`,
    });

    return res.status(200).json({ success: true, data: decision });
  } catch (error) {
    return next(error);
  }
}

async function postMlReward(req, res, next) {
  try {
    const action = String(req.body?.action || '').trim().toUpperCase();
    const decisionId = String(req.body?.decisionId || '').trim();
    const reward = req.body?.reward !== undefined
      ? Number(req.body.reward)
      : rewardFromEvent(req.body?.eventType);

    if (!action) {
      return res.status(400).json({ success: false, message: 'action is required.' });
    }

    const decisionLog = decisionId
      ? await ExperienceLog.findOne({ decisionId }).lean()
      : null;
    const features = req.body?.features && typeof req.body.features === 'object'
      ? req.body.features
      : (decisionLog?.features || {});

    const control = await ExperienceControl.findOne({ key: 'default' }).lean();
    const updated = await updateReward({
      action,
      reward,
      features,
      learningRate: control?.ml?.learningRate ?? 0.08,
      exploration: Boolean(req.body?.exploration),
    });

    if (decisionLog) {
      await ExperienceLog.updateOne(
        { _id: decisionLog._id },
        {
          $set: {
            'result.reward': reward,
            'result.purchased': reward >= 1,
            'result.trialConverted': reward >= 0.7 && reward < 1,
          },
        },
      );
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  getMlDecision,
  postMlReward,
};
