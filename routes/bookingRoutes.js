const express = require('express');

const authMiddleware = require('../middleware/authMiddleware');
const { createBooking, listMyBookings } = require('../controllers/bookingController');

const router = express.Router();

router.get('/me', authMiddleware, listMyBookings);
router.post('/', authMiddleware, createBooking);

module.exports = router;
