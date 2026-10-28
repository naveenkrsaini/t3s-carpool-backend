// routes/rideLifecycleRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, requireDriver } = require('../middlewares/auth');
const { sendPushNotificationToUser } = require('../services/notificationService');

// 1. Driver Side: Verify Passenger Ride Start OTP
router.post('/verify-otp', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  let riderIdToNotify = null;

  try {
    const { ride_id, booking_id, entered_otp } = req.body;
    const driver_id = req.user.id;

    if (!ride_id || !booking_id || !entered_otp) {
      return res.status(400).json({ error: 'ride_id, booking_id, aur entered_otp teeno zaroori hain' });
    }

    await client.query('BEGIN');

    // Confirm driver owns this ride
    const rideCheck = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1 FOR UPDATE`,
      [ride_id]
    );

    if (rideCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride nahi mili' });
    }

    if (rideCheck.rows[0].driver_id !== driver_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Aap is ride ke authorized driver nahi hain' });
    }

    // Check Booking & OTP
    const bookingCheck = await client.query(
      `SELECT id, rider_id, ride_id, ride_otp, is_otp_verified, booking_status 
       FROM bookings 
       WHERE id = $1 AND ride_id = $2 
       FOR UPDATE`,
      [booking_id, ride_id]
    );

    if (bookingCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Is ride ke liye booking nahi mili' });
    }

    const booking = bookingCheck.rows[0];

    if (booking.is_otp_verified) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Passenger ka OTP pehle hi verify ho chuka hai' });
    }

    if (booking.ride_otp !== entered_otp.toString().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Amanaya (Invalid) OTP. Kripya passenger se sahi OTP confirm karein.' });
    }

    // Mark OTP as verified
    await client.query(
      `UPDATE bookings 
       SET is_otp_verified = TRUE 
       WHERE id = $1`,
      [booking_id]
    );

    await client.query('COMMIT');

    riderIdToNotify = booking.rider_id;

    // Background push notification trigger (Response block nahi hoga)
    if (riderIdToNotify) {
      sendPushNotificationToUser(
        riderIdToNotify,
        'Boarding Verified 🚗',
        'Aapka Boarding OTP successfully verify ho gaya hai. Shubh yatra!',
        { ride_id, booking_id, type: 'RIDE_STARTED' }
      ).catch((err) => console.error('Push notification failed:', err.message));
    }

    return res.status(200).json({
      message: 'Boarding OTP successfully verify ho gaya hai!',
      booking_id,
      is_otp_verified: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('OTP verification error:', error);
    return res.status(500).json({ error: 'OTP verify karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

// 2. Driver: Officially Start the Ride
router.patch('/:id/start', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const rideId = req.params.id;
    const driverId = req.user.id;

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride nahi mili' });
    }

    const ride = rows[0];
    if (ride.driver_id !== driverId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Anadhikrit (Unauthorized): Aap is ride ke driver nahi hain' });
    }

    if (ride.status !== 'scheduled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Ride start nahi ho sakti. Vartaman status: ${ride.status}` });
    }

    const updated = await client.query(
      `UPDATE rides 
       SET status = 'in_progress', started_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING id, status, started_at`,
      [rideId]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      message: 'Ride officially shuru (in_progress) ho gayi hai',
      ride: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Start ride error:', error);
    return res.status(500).json({ error: 'Ride start karne me error aaya' });
  } finally {
    client.release();
  }
});

// 3. Driver: Officially Complete the Ride
router.patch('/:id/complete', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  let confirmedRiders = [];

  try {
    const rideId = req.params.id;
    const driverId = req.user.id;

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride nahi mili' });
    }

    const ride = rows[0];
    if (ride.driver_id !== driverId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Unauthorized: Aap is ride ke driver nahi hain' });
    }

    if (ride.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Keval 'in_progress' ride ko hi complete kiya ja sakta hai` });
    }

    const updated = await client.query(
      `UPDATE rides 
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP 
       WHERE id = $1 
       RETURNING id, status, completed_at`,
      [rideId]
    );

    // Set payment status to completed for successful cash trips
    await client.query(
      `UPDATE bookings 
       SET payment_status = 'completed' 
       WHERE ride_id = $1 AND payment_status = 'pending'`,
      [rideId]
    );

    // Riders ki list fetch karein push notification ke liye
    const bookedRiders = await client.query(
      `SELECT rider_id FROM bookings WHERE ride_id = $1 AND booking_status = 'confirmed'`,
      [rideId]
    );
    confirmedRiders = bookedRiders.rows;

    await client.query('COMMIT');

    // Sabhi confirmed riders ko post-ride notification dispatch karein
    confirmedRiders.forEach((rider) => {
      sendPushNotificationToUser(
        rider.rider_id,
        'Trip Completed 🎉',
        'Aap apne drop point par pahunch gaye hain. Kripya ride ka feedback aur rating dein!',
        { ride_id: rideId, type: 'RIDE_COMPLETED' }
      ).catch((err) => console.error('Push notification failed:', err.message));
    });

    return res.status(200).json({
      message: 'Trip safaltapoorvak complete mark ho gayi hai',
      ride: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Complete ride error:', error);
    return res.status(500).json({ error: 'Trip complete karte waqt error aaya' });
  } finally {
    client.release();
  }
});

module.exports = router;