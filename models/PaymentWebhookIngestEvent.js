const mongoose = require('mongoose');

const paymentWebhookIngestEventSchema = new mongoose.Schema(
  {
    ingestId: { type: String, required: true, unique: true, index: true, trim: true },
    source: { type: String, required: true, index: true, trim: true },
    event: { type: String, required: true, index: true, trim: true },
    eventId: { type: String, required: true, index: true, trim: true },
    status: { type: String, enum: ['pending', 'processing', 'processed', 'failed'], default: 'pending', index: true },
    attempts: { type: Number, default: 0, min: 0, index: true },
    maxAttempts: { type: Number, default: 8, min: 1 },
    nextAttemptAt: { type: Date, default: Date.now, index: true },
    deadLetter: { type: Boolean, default: false, index: true },
    deadLetterReason: { type: String, default: '', trim: true },
    lastError: { type: String, default: '', trim: true },
    lastErrorAt: { type: Date, default: null },
    lockedBy: { type: String, default: '', trim: true, index: true },
    lockExpiresAt: { type: Date, default: null, index: true },
    heartbeatAt: { type: Date, default: null },
    processingStartedAt: { type: Date, default: null },
    processedAtIso: { type: String, default: '', trim: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadHash: { type: String, default: '', trim: true, index: true },
    metadata: { type: Map, of: String, default: {} },
  },
  { timestamps: true },
);

paymentWebhookIngestEventSchema.index({ status: 1, deadLetter: 1, nextAttemptAt: 1, lockExpiresAt: 1 });
paymentWebhookIngestEventSchema.index({ source: 1, eventId: 1 }, { unique: true });
paymentWebhookIngestEventSchema.index({ source: 1, event: 1, eventId: 1 });

module.exports = mongoose.model('PaymentWebhookIngestEvent', paymentWebhookIngestEventSchema);
