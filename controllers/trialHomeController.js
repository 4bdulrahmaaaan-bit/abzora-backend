const {
  serializeTrialHomeSession,
  createTrialHomeSession,
  requestTrialHomeSession,
  listTrialHomeSessionsForUser,
  getTrialHomeSessionForUser,
  modifyTrialHomeSession,
  cancelTrialHomeSession,
  submitTrialHomeFeedback,
  convertTrialHomeToOrder,
  convertTrialHomeToTailoring,
  canActorApproveTrialSession,
  approveTrialHomeRequest,
  rejectTrialHomeRequest,
  listTrialHomeSessionsForVendor,
  listTrialHomeProductsForVendor,
  updateTrialHomeProductForVendor,
  getTrialHomeDashboardForVendor,
  updateTrialHomeSessionForVendor,
} = require('../services/trialHomeService');
const TrialHomeSession = require('../models/TrialHomeSession');

function unauthorized(res) {
  return res.status(401).json({ success: false, message: 'Unauthorized' });
}

async function bookTrialHome(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await createTrialHomeSession({
      userId: req.user.uid,
      payload: req.body || {},
    });

    return res.status(201).json({
      success: true,
      data: serializeTrialHomeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

async function requestTrialHome(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await requestTrialHomeSession({
      userId: req.user.uid,
      actor: req.dbUser || req.user,
      payload: req.body || {},
    });

    return res.status(201).json({
      success: true,
      data: serializeTrialHomeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

async function listMyTrialHomeSessions(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const sessions = await listTrialHomeSessionsForUser(req.user.uid);
    return res.status(200).json({
      success: true,
      data: sessions.map(serializeTrialHomeSession),
    });
  } catch (error) {
    return next(error);
  }
}

async function getTrialHomeSession(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(session),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateTrialHomeSession(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const updated = await modifyTrialHomeSession({
      session,
      payload: req.body || {},
      actorId: req.user.uid,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function cancelTrialHome(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const cancelled = await cancelTrialHomeSession({
      session,
      actorId: req.user.uid,
      note: req.body?.note,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(cancelled),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveTrialHomeFeedback(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const updated = await submitTrialHomeFeedback({
      session,
      payload: req.body || {},
      actorId: req.user.uid,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function convertTrialHomeSessionToOrder(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const updated = await convertTrialHomeToOrder({
      session,
      payload: req.body || {},
      actorId: req.user.uid,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function convertTrialHomeSessionToTailoring(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const updated = await convertTrialHomeToTailoring({
      session,
      payload: req.body || {},
      actorId: req.user.uid,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function approveTrialHome(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    }) || (
      req.user?.role === 'admin' ||
      req.user?.role === 'super_admin' ||
      req.user?.role === 'vendor'
        ? await TrialHomeSession.findById(req.params.id)
        : null
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const allowed = await canActorApproveTrialSession({
      session,
      actor: req.user,
    });
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Approval access denied.' });
    }

    const updated = await approveTrialHomeRequest({
      session,
      actor: req.user,
      note: req.body?.note,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function rejectTrialHome(req, res, next) {
  try {
    if (!req.user?.uid) {
      return unauthorized(res);
    }

    const session = await getTrialHomeSessionForUser({
      sessionId: req.params.id,
      userId: req.user.uid,
    }) || (
      req.user?.role === 'admin' ||
      req.user?.role === 'super_admin' ||
      req.user?.role === 'vendor'
        ? await TrialHomeSession.findById(req.params.id)
        : null
    );

    if (!session) {
      return res.status(404).json({ success: false, message: 'Trial-home session not found.' });
    }

    const allowed = await canActorApproveTrialSession({
      session,
      actor: req.user,
    });
    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Rejection access denied.' });
    }

    const updated = await rejectTrialHomeRequest({
      session,
      actor: req.user,
      note: req.body?.note,
    });

    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

function ensureVendor(req, res) {
  if (!req.user?.uid) {
    unauthorized(res);
    return false;
  }
  if (req.user.role !== 'vendor') {
    res.status(403).json({
      success: false,
      message: 'Vendor access required.',
    });
    return false;
  }
  return true;
}

async function getVendorTrialHomeDashboard(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const dashboard = await getTrialHomeDashboardForVendor(req.user);
    return res.status(200).json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    return next(error);
  }
}

async function listVendorTrialHomeSessions(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const sessions = await listTrialHomeSessionsForVendor({
      actor: req.user,
      status: req.query.status?.toString().trim() || '',
      approvalStatus: req.query.approvalStatus?.toString().trim() || '',
    });
    return res.status(200).json({
      success: true,
      data: sessions.map(serializeTrialHomeSession),
    });
  } catch (error) {
    return next(error);
  }
}

async function updateVendorTrialHomeSession(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const updated = await updateTrialHomeSessionForVendor({
      actor: req.user,
      sessionId: req.params.id,
      payload: req.body || {},
    });
    return res.status(200).json({
      success: true,
      data: serializeTrialHomeSession(updated),
    });
  } catch (error) {
    return next(error);
  }
}

async function listVendorTrialHomeProductSettings(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const products = await listTrialHomeProductsForVendor(req.user);
    return res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    return next(error);
  }
}

async function updateVendorTrialHomeProductSettings(req, res, next) {
  try {
    if (!ensureVendor(req, res)) {
      return;
    }
    const updated = await updateTrialHomeProductForVendor({
      actor: req.user,
      productId: req.params.productId,
      payload: req.body || {},
    });
    return res.status(200).json({
      success: true,
      data: updated,
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  bookTrialHome,
  requestTrialHome,
  listMyTrialHomeSessions,
  getTrialHomeSession,
  updateTrialHomeSession,
  cancelTrialHome,
  saveTrialHomeFeedback,
  convertTrialHomeSessionToOrder,
  convertTrialHomeSessionToTailoring,
  approveTrialHome,
  rejectTrialHome,
  getVendorTrialHomeDashboard,
  listVendorTrialHomeSessions,
  updateVendorTrialHomeSession,
  listVendorTrialHomeProductSettings,
  updateVendorTrialHomeProductSettings,
};
