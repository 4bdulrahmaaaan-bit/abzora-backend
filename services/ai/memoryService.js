const ConversationMemoryEntry = require('../../models/ConversationMemoryEntry');

function truncate(value, max = 160) {
  const clean = String(value || '').trim().replace(/\s+/g, ' ');
  if (clean.length <= max) {
    return clean;
  }
  return `${clean.slice(0, max - 3)}...`;
}

function summarizeMessages(messages) {
  if (!messages.length) {
    return '';
  }

  return messages
    .slice(-6)
    .map((item) => `${item.role}: ${truncate(item.text, item.role === 'assistant' ? 80 : 100)}`)
    .join(' | ');
}

async function getTieredMemory({ userId, chatId }) {
  const entries = await ConversationMemoryEntry.find({ userId, chatId })
    .sort({ timestamp: -1, _id: -1 })
    .limit(12);

  const ordered = entries.reverse().map((item) => ({
    id: item.entryId,
    role: item.role,
    text: item.text,
    timestamp: item.timestamp,
  }));

  const shortTerm = ordered.slice(-2);
  const midSource = ordered.slice(Math.max(0, ordered.length - 8), Math.max(0, ordered.length - 2));
  const midTerm = summarizeMessages(midSource);
  const longTerm = ordered.length > 8 ? 'available_in_db' : '';

  return {
    shortTerm,
    midTerm,
    longTerm,
    totalMessages: ordered.length,
  };
}

async function appendHistoryEntry({ userId, chatId, entryId, role, text, timestamp }) {
  await ConversationMemoryEntry.findOneAndUpdate(
    { userId, chatId, entryId },
    { userId, chatId, entryId, role, text, timestamp },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const history = await ConversationMemoryEntry.find({ userId, chatId })
    .sort({ timestamp: -1, _id: -1 });

  if (history.length > 30) {
    const overflow = history.slice(30);
    await ConversationMemoryEntry.deleteMany({
      _id: { $in: overflow.map((item) => item._id) },
    });
  }
}

async function clearHistory(userId) {
  await ConversationMemoryEntry.deleteMany({ userId });
}

module.exports = {
  getTieredMemory,
  appendHistoryEntry,
  clearHistory,
};
