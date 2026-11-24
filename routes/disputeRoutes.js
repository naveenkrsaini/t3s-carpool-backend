// routes/disputeRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');
const { sendPushNotificationToUser } = require('../services/notificationService');
const { calculateCancellationPenalty } = require('../utils/cancellationPolicy');

// 1. Cancel Booking with Automatic Seat Restitution, Penalty Breakdown & Driver Notification
router.patch('/cancel-booking/:bookingId', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  let driverToNotify = null;

  try {
    const { bookingId } = req.params;
    const { cancellation_reason } = req.body;
    const userId = req.user.id;

    await client.query('BEGIN');

    const bookingQuery = await client.query(
      `SELECT b.id, b.rider_id, b.ride_id, b.seats_booked, b.booking_status,
              b.total_payable_amount, r.driver_id, r.origin, r.destination,
              r.departure_time, r.status AS ride_status
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       WHERE b.id = $1
       FOR UPDATE`,
      [bookingId]
    );

    if (bookingQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking nahi mili' });
    }

    const booking = bookingQuery.rows[0];

    if (booking.rider_id !== userId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Aap is booking ko cancel karne ke liye authorized nahi hain' });
    }

    if (booking.booking_status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Yeh booking pehle hi cancel ho chuki hai' });
    }

    if (booking.ride_status === 'in_progress' || booking.ride_status === 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Active ya completed trip ko cancel nahi kiya ja sakta' });
    }

    const penaltyDetails = calculateCancellationPenalty(
      booking.departure_time,
      booking.total_payable_amount,
      'rider'
    );

    await client.query(
      `UPDATE bookings
       SET booking_status = 'cancelled',
           cancellation_reason = $1,
           cancellation_penalty = $2,
           refund_amount = $3,
           cancelled_by = $4,
           cancelled_at = NOW()
       WHERE id = $5`,
      [
        cancellation_reason || 'Rider dwara cancel kiya gaya',
        penaltyDetails.penaltyAmount,
        penaltyDetails.refundAmount,
        userId,
        bookingId,
      ]
    );

    await client.query(
      `UPDATE rides
       SET seats_available = seats_available + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [booking.seats_booked, booking.ride_id]
    );

    await client.query(
      `INSERT INTO admin_audit_logs (
        action_type, target_user_id, target_ride_id, notes
      ) VALUES ('BOOKING_CANCELLED', $1, $2, $3)`,
      [
        userId,
        booking.ride_id,
        `Penalty: ₹${penaltyDetails.penaltyAmount}, Refund: ₹${penaltyDetails.refundAmount}, Reason: ${cancellation_reason || 'N/A'}`,
      ]
    );

    await client.query('COMMIT');

    driverToNotify = {
      driverId: booking.driver_id,
      rideId: booking.ride_id,
      seatsBooked: booking.seats_booked,
      origin: booking.origin,
      destination: booking.destination,
    };

    if (driverToNotify.driverId) {
      sendPushNotificationToUser(
        driverToNotify.driverId,
        'Seat Cancelled by Rider',
        `${driverToNotify.seatsBooked} seat(s) cancelled for ${driverToNotify.origin} ➔ ${driverToNotify.destination}.`,
        { ride_id: driverToNotify.rideId, booking_id: bookingId, type: 'BOOKING_CANCELLED' }
      ).catch((e) => console.error('Driver cancel notification failed:', e.message));
    }

    return res.status(200).json({
      success: true,
      message: 'Booking safaltapoorvak cancel kar di gayi hai',
      cancellation_summary: {
        penalty_amount: penaltyDetails.penaltyAmount,
        refund_amount: penaltyDetails.refundAmount,
        policy_note: penaltyDetails.reason,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancellation error:', error);
    return res.status(500).json({ error: 'Cancellation process karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

// 2. Raise Dispute / File Complaint against Ride
router.post('/raise-dispute', verifyToken, async (req, res) => {
  try {
    const { ride_id, dispute_type, description } = req.body;
    const userId = req.user.id;

    if (!ride_id || !dispute_type || !description) {
      return res.status(400).json({ error: 'ride_id, dispute_type aur description zaroori hain' });
    }

    const validTypes = ['OVERCHARGING', 'RUDE_BEHAVIOR', 'UNSAFE_DRIVING', 'ROUTE_DEVIATION', 'OTHER'];
    if (!validTypes.includes(dispute_type)) {
      return res.status(400).json({ error: `Valid dispute_type chunein: ${validTypes.join(', ')}` });
    }

    const { rows } = await db.query(
      `INSERT INTO ride_disputes (
        ride_id, reporter_id, dispute_type, description, status
      ) VALUES ($1, $2, $3, $4, 'open')
      RETURNING *`,
      [ride_id, userId, dispute_type, description.trim()]
    );

    return res.status(201).json({
      success: true,
      message: 'Aapka dispute ticket safaltapoorvak darj ho chuka hai. Support team jald samiksha karegi.',
      dispute: rows[0],
    });
  } catch (error) {
    console.error('Raise dispute error:', error);
    return res.status(500).json({ error: 'Dispute raise karne mein error aaya' });
  }
});

module.exports = router;