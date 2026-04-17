const OpsActionLog = require('../models/OpsActionLog');

async function logOpsAction({
  alertId = '',
  action,
  status = 'STARTED',
  entityType = '',
  entityId = '',
  actorId = 'system',
  attempt = 0,
  details = {},
  error = '',
}) {
  if (!action) {
    return null;
  }
  return OpsActionLog.create({
    alertId: String(alertId || '').trim(),
    action: String(action || '').trim(),
    status: String(status || 'STARTED').trim().toUpperCase(),
    entityType: String(entityType || '').trim(),
    entityId: String(entityId || '').trim(),
    actorId: String(actorId || 'system').trim(),
    attempt: Number(attempt || 0),
    details: details && typeof details === 'object' ? details : {},
    error: String(error || '').trim(),
  });
}

module.exports = {
  logOpsAction,
};
