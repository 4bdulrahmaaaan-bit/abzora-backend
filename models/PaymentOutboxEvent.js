const mongoose = require('mongoose');

const paymentOutboxEventSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true, index: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    orderId: { type: String, required: true, index: true, trim: true },
    payload: { type: Map, of: String, default: {} },
    status: { type: String, enum: ['pending', 'processed', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0, min: 0, index: true },
    maxAttempts: { type: Number, default: 8, min: 1 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    lockedBy: { type: String, trim: true, default: '', index: true },
    lockExpiresAt: { type: Date, default: null, index: true },
    heartbeatAt: { type: Date, default: null },
    processingStartedAt: { type: Date, default: null },
    lastErrorAt: { type: Date, default: null },
    processedAtIso: { type: String, trim: true, default: '' },
    lastError: { type: String, trim: true, default: '' },
    deadLetter: { type: Boolean, default: false, index: true },
    deadLetterReason: { type: String, trim: true, default: '' },
    completedTargets: { type: [String], default: [] },
    targetErrors: { type: Map, of: String, default: {} },
    metadata: { type: Map, of: String, default: {} },
  },
  { timestamps: true },
);

paymentOutboxEventSchema.index({ status: 1, deadLetter: 1, nextAttemptAt: 1, lockExpiresAt: 1 });
paymentOutboxEventSchema.index({ eventType: 1, orderId: 1, createdAt: -1 });

module.exports = mongoose.model('PaymentOutboxEvent', paymentOutboxEventSchema);
