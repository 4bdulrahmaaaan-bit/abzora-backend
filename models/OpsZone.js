const mongoose = require('mongoose');

const opsZoneSchema = new mongoose.Schema(
  {
    zoneId: { type: String, required: true, unique: true, index: true, trim: true },
    city: { type: String, default: '', trim: true, index: true },
    center: {
      lat: { type: Number, default: 0 },
      lng: { type: Number, default: 0 },
    },
    radiusKm: { type: Number, default: 2.5, min: 1, max: 5 },
    activeOrders: { type: Number, default: 0, min: 0 },
    activeRiders: { type: Number, default: 0, min: 0 },
    demandScore: { type: Number, default: 0, min: 0, index: true },
    frozen: { type: Boolean, default: false, index: true },
    freezeReason: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAtIso: { type: String, default: '', trim: true },
  },
  { timestamps: true, collection: 'ops_zones' },
);

opsZoneSchema.index({ city: 1, demandScore: -1 });

module.exports = mongoose.model('OpsZone', opsZoneSchema);
