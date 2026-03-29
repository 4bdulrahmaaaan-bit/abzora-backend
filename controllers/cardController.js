const SavedCard = require('../models/SavedCard');

function serializeCard(card) {
  const source = typeof card.toObject === 'function' ? card.toObject() : card;
  return {
    id: source._id?.toString() || source.id || '',
    userId: source.userId || '',
    token: source.token || '',
    last4: source.last4 || '0000',
    cardType: source.cardType || 'Card',
    gatewayCustomerId: source.gatewayCustomerId || '',
    createdAt: source.createdAt || null,
  };
}

async function listSavedCards(req, res, next) {
  try {
    const cards = await SavedCard.find({ userId: req.user.uid }).sort({ createdAt: -1 });
    return res.status(200).json({
      success: true,
      data: cards.map(serializeCard),
    });
  } catch (error) {
    return next(error);
  }
}

async function saveCard(req, res, next) {
  try {
    const token = req.body?.token?.toString().trim() || '';
    const last4 = req.body?.last4?.toString().trim() || '';
    const cardType = req.body?.cardType?.toString().trim() || 'Card';
    const gatewayCustomerId = req.body?.gatewayCustomerId?.toString().trim() || '';

    if (!token || !last4) {
      return res.status(400).json({
        success: false,
        message: 'token and last4 are required.',
      });
    }

    const card = await SavedCard.findOneAndUpdate(
      { userId: req.user.uid, token },
      {
        userId: req.user.uid,
        token,
        last4,
        cardType,
        gatewayCustomerId,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    return res.status(201).json({ success: true, data: serializeCard(card) });
  } catch (error) {
    return next(error);
  }
}

async function deleteCard(req, res, next) {
  try {
    const cardId = req.params.id?.toString() || '';
    await SavedCard.findOneAndDelete({
      _id: cardId,
      userId: req.user.uid,
    });
    return res.status(200).json({ success: true, data: { id: cardId } });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  listSavedCards,
  saveCard,
  deleteCard,
};
