const mongoose = require('mongoose');

const ChatThread = require('../models/ChatThread');
const ChatMessage = require('../models/ChatMessage');

function serializeChat(thread, viewerId) {
  const source = typeof thread.toObject === 'function' ? thread.toObject() : thread;
  const participants = Array.isArray(source.participantIds) ? source.participantIds : [];
  const fallbackName = participants.find((id) => id !== viewerId) || 'Abzora Support';
  return {
    id: source._id?.toString() || source.id || '',
    otherUserName: source.otherUserName || fallbackName,
    lastMessage: source.lastMessage || '',
    time: source.lastTimestamp || '',
    unreadCount: Number(source.unreadCount || 0),
    isVerified: source.isVerified ?? true,
    participantIds: participants,
  };
}

function serializeMessage(message) {
  const source = typeof message.toObject === 'function' ? message.toObject() : message;
  return {
    id: source._id?.toString() || source.id || '',
    senderId: source.senderId || '',
    text: source.text || '',
    timestamp: source.timestamp || '',
  };
}

async function listChats(req, res, next) {
  try {
    const chats = await ChatThread.find({ participantIds: req.user.uid }).sort({ updatedAt: -1, createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: chats.map((chat) => serializeChat(chat, req.user.uid)),
    });
  } catch (error) {
    return next(error);
  }
}

async function listMessages(req, res, next) {
  try {
    const chatId = req.params.id?.toString() || '';
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chat id.' });
    }

    const chat = await ChatThread.findById(chatId);
    if (!chat || !chat.participantIds.includes(req.user.uid)) {
      return res.status(404).json({ success: false, message: 'Chat not found.' });
    }

    const messages = await ChatMessage.find({ chatId }).sort({ createdAt: 1, _id: 1 });
    return res.status(200).json({
      success: true,
      data: messages.map(serializeMessage),
    });
  } catch (error) {
    return next(error);
  }
}

async function sendMessage(req, res, next) {
  try {
    const chatId = req.params.id?.toString() || '';
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      return res.status(400).json({ success: false, message: 'Invalid chat id.' });
    }

    const chat = await ChatThread.findById(chatId);
    if (!chat || !chat.participantIds.includes(req.user.uid)) {
      return res.status(404).json({ success: false, message: 'Chat not found.' });
    }

    const text = req.body?.text?.toString().trim() || '';
    if (!text) {
      return res.status(400).json({ success: false, message: 'Message text is required.' });
    }

    const timestamp = req.body?.timestamp?.toString().trim() || new Date().toISOString();
    const message = await ChatMessage.create({
      chatId,
      senderId: req.user.uid,
      text,
      timestamp,
    });

    chat.lastMessage = text;
    chat.lastTimestamp = timestamp;
    chat.unreadCount = 0;
    await chat.save();

    return res.status(201).json({
      success: true,
      data: serializeMessage(message),
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listChats,
  listMessages,
  sendMessage,
};
