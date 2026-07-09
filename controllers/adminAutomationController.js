const AdminAutomation = require('../models/AdminAutomation');
const AdminActivityLog = require('../models/AdminActivityLog');
const adminAutomationService = require('../services/adminAutomationService');
const { ensureAdmin } = require('./adminController');

async function listAutomations(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const automations = await AdminAutomation.find({}).sort({ name: 1 });
    res.status(200).json({ success: true, data: automations });
  } catch (error) {
    next(error);
  }
}

async function toggleAutomation(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { enabled } = req.body;

    const automation = await AdminAutomation.findById(id);
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found' });

    const previousState = { enabled: automation.enabled };
    automation.enabled = enabled;
    await automation.save();

    if (enabled) {
      adminAutomationService.scheduleJob(automation);
    } else {
      adminAutomationService.stopJob(automation.name);
    }

    const adminEmail = req.user?.email || 'system@abzora.com';
    await AdminActivityLog.create({
      adminEmail,
      action: 'UPDATE_AUTOMATION_STATUS',
      entityType: 'Automation',
      entityId: automation._id.toString(),
      previousState,
      newState: { enabled },
      notes: `Automation ${automation.name} ${enabled ? 'enabled' : 'disabled'}`,
    });

    res.status(200).json({ success: true, data: automation });
  } catch (error) {
    next(error);
  }
}

async function updateAutomationSchedule(req, res, next) {
  try {
    if (!ensureAdmin(req, res)) return;
    const { id } = req.params;
    const { cronExpression } = req.body;

    const automation = await AdminAutomation.findById(id);
    if (!automation) return res.status(404).json({ success: false, message: 'Automation not found' });

    const previousState = { cronExpression: automation.cronExpression };
    automation.cronExpression = cronExpression;
    await automation.save();

    if (automation.enabled) {
      adminAutomationService.scheduleJob(automation);
    }

    const adminEmail = req.user?.email || 'system@abzora.com';
    await AdminActivityLog.create({
      adminEmail,
      action: 'UPDATE_AUTOMATION_SCHEDULE',
      entityType: 'Automation',
      entityId: automation._id.toString(),
      previousState,
      newState: { cronExpression },
      notes: `Schedule updated for ${automation.name}`,
    });

    res.status(200).json({ success: true, data: automation });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listAutomations,
  toggleAutomation,
  updateAutomationSchedule,
};
