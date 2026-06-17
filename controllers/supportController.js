const mongoose = require('mongoose');

const SupportChat = require('../models/SupportChat');
const SupportMessage = require('../models/SupportMessage');
const { hasRole } = require('../middleware/authorizationMiddleware');
const { isAllowedAdminEmail } = require('./authController');

function isAdmin(req) {
  return (
    hasRole(req.user, ['admin', 'super_admin']) &&
    isAllowedAdminEmail(req.user?.email || req.dbUser?.email)
  );
}

function normalizeOptionalUrl(value) {
  const normalized = value?.toString().trim() || '';
  if (!normalized) {
    return '';
  }
  try {
    const parsed = new URL(normalized);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch (_) {
    return '';
  }
}

function normalizeChatStatus(value) {
  const normalized = value?.toString().trim().toLowerCase() || '';
  return ['open', 'closed'].includes(normalized) ? normalized : '';
}

function serializeSupportChat(chat) {
  const source = typeof chat.toObject === 'function' ? chat.toObject() : chat;
  const participantIds =
    source.participantIds instanceof Map
      ? Object.fromEntries(source.participantIds.entries())
      : Object.fromEntries(Object.entries(source.participantIds || {}).map(([key, value]) => [key, Boolean(value)]));
  return {
    id: source._id?.toString() || source.id || '',
    userId: source.userId || '',
    type: source.type || 'general',
    status: source.status || 'open',
    createdAt: source.createdAt || '',
    updatedAt: source.updatedAt || source.createdAt || '',
    lastMessage: source.lastMessage || '',
    lastMessageAt: source.lastMessageAt || '',
    lastSenderId: source.lastSenderId || '',
    lastSenderRole: source.lastSenderRole || '',
    userName: source.userName || '',
    userPhone: source.userPhone || '',
    ticketId: source.ticketId || '',
    orderId: source.orderId || '',
    unreadCountUser: Number(source.unreadCountUser || 0),
    unreadCountAdmin: Number(source.unreadCountAdmin || 0),
    participantIds,
  };
}

function serializeSupportMessage(message) {
  const source = typeof message.toObject === 'function' ? message.toObject() : message;
  return {
    id: source._id?.toString() || source.id || '',
    senderId: source.senderId || '',
    senderRole: source.senderRole || 'user',
    text: source.text || '',
    imageUrl: source.imageUrl || '',
    timestamp: source.timestamp || '',
    read: Boolean(source.read),
  };
}

async function getAccessibleChat(chatId, req) {
  if (!mongoose.Types.ObjectId.isValid(chatId)) {
    return null;
  }
  const chat = await SupportChat.findById(chatId);
  if (!chat) {
    return null;
  }
  if (!isAdmin(req) && chat.userId !== req.user.uid) {
    throw Object.assign(new Error('Support chat access denied.'), { statusCode: 403 });
  }
  return chat;
}

function assistantWelcomeMessage(userName, issueType) {
  const firstName = userName?.trim() ? userName.trim().split(' ')[0] : 'there';
  switch (issueType) {
    case 'order':
      return `Hi ${firstName}, I can track your latest order, explain the delivery stage, or help cancel it if it is still eligible.`;
    case 'payment':
      return `Hi ${firstName}, I can check payment status, explain refunds, and help you understand what happened with your last order payment.`;
    case 'custom':
      return `Hi ${firstName}, I can guide you with measurements, fit questions, and custom clothing decisions based on your saved profile.`;
    default:
      return `Hi ${firstName}, I am Abianzo Assistant. Ask me about orders, payments, delivery updates, or custom clothing and I will help instantly.`;
  }
}

async function listSupportChats(req, res, next) {
  try {
    const status = req.query.status?.toString();
    const type = req.query.type?.toString();
    const query = isAdmin(req) ? {} : { userId: req.user.uid };
    if (status && status !== 'all') {
      query.status = status;
    }
    if (type && type !== 'all') {
      query.type = type;
    }
    const chats = await SupportChat.find(query).sort({ updatedAt: -1, createdAt: -1 });
    return res.status(200).json({ success: true, data: chats.map(serializeSupportChat) });
  } catch (error) {
    return next(error);
  }
}

async function getSupportChat(req, res, next) {
  try {
    const chat = await getAccessibleChat(req.params.id?.toString() || '', req);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Support chat not found.' });
    }
    return res.status(200).json({ success: true, data: serializeSupportChat(chat) });
  } catch (error) {
    return next(error);
  }
}

async function listSupportMessages(req, res, next) {
  try {
    const chat = await getAccessibleChat(req.params.id?.toString() || '', req);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Support chat not found.' });
    }
    const beforeTimestamp = req.query.before?.toString().trim() || '';
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    const query = { chatId: chat._id };
    if (beforeTimestamp) {
      query.timestamp = { $lt: beforeTimestamp };
    }
    const messages = await SupportMessage.find(query).sort({ timestamp: -1, _id: -1 }).limit(limit);
    const ordered = messages.reverse().map(serializeSupportMessage);
    return res.status(200).json({ success: true, data: ordered });
  } catch (error) {
    return next(error);
  }
}

async function createSupportChat(req, res, next) {
  try {
    const type = req.body?.issueType?.toString().trim().toLowerCase() || 'general';
    const existing = await SupportChat.findOne({
      userId: req.user.uid,
      type,
      status: { $ne: 'closed' },
    }).sort({ updatedAt: -1 });
    if (existing) {
      return res.status(200).json({ success: true, data: serializeSupportChat(existing) });
    }

    const nowIso = new Date().toISOString();
    const welcome = assistantWelcomeMessage(req.user.name, type);
    const chat = await SupportChat.create({
      userId: req.user.uid,
      type,
      status: 'open',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastMessage: welcome,
      lastMessageAt: nowIso,
      lastSenderId: 'abianzo-assistant',
      lastSenderRole: 'assistant',
      userName: req.user.name || '',
      userPhone: req.user.phone || '',
      ticketId: `ticket-${Date.now()}`,
      participantIds: {
        [req.user.uid]: true,
      },
      unreadCountUser: 0,
      unreadCountAdmin: 0,
    });

    await SupportMessage.create({
      chatId: chat._id,
      senderId: 'abianzo-assistant',
      senderRole: 'assistant',
      text: welcome,
      imageUrl: '',
      timestamp: nowIso,
      read: true,
    });

    return res.status(201).json({ success: true, data: serializeSupportChat(chat) });
  } catch (error) {
    return next(error);
  }
}

async function sendSupportMessage(req, res, next) {
  try {
    const chat = await getAccessibleChat(req.params.id?.toString() || '', req);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Support chat not found.' });
    }

    const text = req.body?.text?.toString().trim() || '';
    const imageUrl = normalizeOptionalUrl(req.body?.imageUrl);
    if (req.body?.imageUrl && !imageUrl) {
      return res.status(400).json({ success: false, message: 'imageUrl must be a valid http/https URL.' });
    }
    if (!text && !imageUrl) {
      return res.status(400).json({ success: false, message: 'Message text or image is required.' });
    }

    const nowIso = new Date().toISOString();
    const senderRole = isAdmin(req) ? 'admin' : 'user';

    await SupportMessage.create({
      chatId: chat._id,
      senderId: req.user.uid,
      senderRole,
      text,
      imageUrl,
      timestamp: nowIso,
      read: false,
    });

    let lastMessage = text || 'Attachment shared';
    let lastMessageAt = nowIso;
    let lastSenderId = req.user.uid;
    let lastSenderRole = senderRole;
    let unreadCountAdmin = isAdmin(req) ? 0 : Number(chat.unreadCountAdmin || 0) + 1;
    let unreadCountUser = isAdmin(req) ? Number(chat.unreadCountUser || 0) + 1 : 0;

    const assistantReply = isAdmin(req) ? req.body?.assistantReplyText?.toString().trim().slice(0, 4000) || '' : '';
    if (assistantReply) {
      const assistantTimestamp = new Date(Date.now() + 450).toISOString();
      await SupportMessage.create({
        chatId: chat._id,
        senderId: 'abianzo-assistant',
        senderRole: 'assistant',
        text: assistantReply,
        imageUrl: '',
        timestamp: assistantTimestamp,
        read: true,
      });
      lastMessage = assistantReply;
      lastMessageAt = assistantTimestamp;
      lastSenderId = 'abianzo-assistant';
      lastSenderRole = 'assistant';
      unreadCountAdmin = 0;
      unreadCountUser = 0;
    }

    chat.lastMessage = lastMessage;
    chat.lastMessageAt = lastMessageAt;
    chat.lastSenderId = lastSenderId;
    chat.lastSenderRole = lastSenderRole;
    chat.updatedAt = lastMessageAt;
    chat.unreadCountAdmin = unreadCountAdmin;
    chat.unreadCountUser = unreadCountUser;
    const nextStatus = isAdmin(req) ? normalizeChatStatus(req.body?.status) : '';
    if (nextStatus) {
      chat.status = nextStatus;
    } else {
      chat.status = chat.status || 'open';
    }
    await chat.save();

    return res.status(201).json({ success: true, data: serializeSupportChat(chat) });
  } catch (error) {
    return next(error);
  }
}

async function markSupportChatRead(req, res, next) {
  try {
    const chat = await getAccessibleChat(req.params.id?.toString() || '', req);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Support chat not found.' });
    }
    if (isAdmin(req)) {
      chat.unreadCountAdmin = 0;
    } else {
      chat.unreadCountUser = 0;
    }
    await chat.save();
    return res.status(200).json({ success: true, data: serializeSupportChat(chat) });
  } catch (error) {
    return next(error);
  }
}

async function closeSupportChat(req, res, next) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Support admin access required.' });
    }
    const chat = await getAccessibleChat(req.params.id?.toString() || '', req);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Support chat not found.' });
    }
    chat.status = 'closed';
    chat.updatedAt = new Date().toISOString();
    await chat.save();
    return res.status(200).json({ success: true, data: serializeSupportChat(chat) });
  } catch (error) {
    return next(error);
  }
}

async function reopenSupportChat(req, res, next) {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ success: false, message: 'Support admin access required.' });
    }
    const chat = await getAccessibleChat(req.params.id?.toString() || '', req);
    if (!chat) {
      return res.status(404).json({ success: false, message: 'Support chat not found.' });
    }
    chat.status = 'open';
    chat.updatedAt = new Date().toISOString();
    await chat.save();
    return res.status(200).json({ success: true, data: serializeSupportChat(chat) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listSupportChats,
  getSupportChat,
  listSupportMessages,
  createSupportChat,
  sendSupportMessage,
  markSupportChatRead,
  closeSupportChat,
  reopenSupportChat,
};
