const Booking = require('../models/Booking');

function serializeBooking(booking) {
  if (!booking) {
    return null;
  }

  const source = typeof booking.toObject === 'function' ? booking.toObject() : booking;
  return {
    id: source._id?.toString() || source.id || '',
    userId: source.userId || '',
    tailorId: source.tailorId || '',
    tailorName: source.tailorName || '',
    outfitType: source.outfitType || '',
    appointmentDate: source.appointmentDate || null,
    timeSlot: source.timeSlot || '',
    status: source.status || 'Confirmed',
    notes: source.notes || '',
    createdAt: source.createdAt || null,
    updatedAt: source.updatedAt || null,
  };
}

async function createBooking(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { tailorId, tailorName, outfitType, appointmentDate, timeSlot, status, notes } = req.body || {};
    const normalizedTailorId = tailorId?.toString().trim() || '';
    const normalizedTailorName = tailorName?.toString().trim() || '';
    const normalizedOutfitType = outfitType?.toString().trim() || '';
    const normalizedTimeSlot = timeSlot?.toString().trim() || '';
    const normalizedStatus = status?.toString().trim() || 'Confirmed';
    const normalizedNotes = notes?.toString().trim() || '';
    const parsedDate = appointmentDate ? new Date(appointmentDate) : null;

    if (!normalizedTailorId || !normalizedTailorName || !normalizedOutfitType || !normalizedTimeSlot || !parsedDate || Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'tailorId, tailorName, outfitType, appointmentDate, and timeSlot are required.',
      });
    }

    const booking = await Booking.create({
      userId: req.user.uid,
      tailorId: normalizedTailorId,
      tailorName: normalizedTailorName,
      outfitType: normalizedOutfitType,
      appointmentDate: parsedDate,
      timeSlot: normalizedTimeSlot,
      status: normalizedStatus,
      notes: normalizedNotes,
    });

    return res.status(201).json({ success: true, data: serializeBooking(booking) });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return next(error);
  }
}

async function listMyBookings(req, res, next) {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const bookings = await Booking.find({ userId: req.user.uid }).sort({ appointmentDate: -1, createdAt: -1 });
    return res.status(200).json({ success: true, data: bookings.map(serializeBooking) });
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  createBooking,
  listMyBookings,
};
