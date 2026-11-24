// services/cronService.js
const cron = require('node-cron');
const db = require('../config/db');
const { sendPushNotificationToUser } = require('./notificationService');

const initCronJobs = () => {
  // Har 5 minute mein check karega:
  // Departure ke 1 ghante baad bhi ride 'scheduled' hai toh auto-cancel
  cron.schedule('*/5 * * * *', async () => {
    let client = null;
    let expiredRides = [];
    let affectedBookings = [];

    try {
      client = await db.pool.connect();
      await client.query('BEGIN');

      const expiredRidesQuery = `
        SELECT id, driver_id, origin, destination
        FROM rides
        WHERE status = 'scheduled'
          AND departure_time < (NOW() - INTERVAL '1 hour')
        FOR UPDATE SKIP LOCKED;
      `;
      const rideRes = await client.query(expiredRidesQuery);
      expiredRides = rideRes.rows;

      if (expiredRides.length > 0) {
        const rideIds = expiredRides.map((r) => r.id);

        const bookingsRes = await client.query(
          `SELECT id, ride_id, rider_id
           FROM bookings
           WHERE ride_id = ANY($1::uuid[]) AND booking_status = 'confirmed'`,
          [rideIds]
        );
        affectedBookings = bookingsRes.rows;

        await client.query(
          `UPDATE rides
           SET status = 'cancelled',
               cancellation_reason = COALESCE(cancellation_reason, 'Auto-cancelled after 1 hour delay'),
               cancelled_at = NOW(),
               updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [rideIds]
        );

        await client.query(
          `UPDATE bookings
           SET booking_status = 'cancelled',
               cancellation_reason = COALESCE(cancellation_reason, 'Ride auto-cancelled after 1 hour delay'),
               cancelled_at = NOW()
           WHERE ride_id = ANY($1::uuid[]) AND booking_status = 'confirmed'`,
          [rideIds]
        );

        console.log(`[Auto-Expiry Cron] ${rideIds.length} rides auto-cancelled after 1 hour.`);
      }

      await client.query('COMMIT');
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore rollback error
        }
      }
      console.error('[Auto-Expiry Cron Error]:', err.message);
      return;
    } finally {
      if (client) {
        client.release();
      }
    }

    for (const ride of expiredRides) {
      sendPushNotificationToUser(
        ride.driver_id,
        'Ride Auto-Cancelled',
        `Your ride (${ride.origin} ➔ ${ride.destination}) was cancelled after 1 hour without starting.`,
        { ride_id: ride.id, type: 'RIDE_AUTO_CANCELLED' }
      ).catch((e) => console.error('Driver auto-cancel push failed:', e.message));
    }

    for (const booking of affectedBookings) {
      const rideInfo = expiredRides.find((r) => r.id === booking.ride_id);
      sendPushNotificationToUser(
        booking.rider_id,
        'Booking Cancelled',
        `Your ride (${rideInfo?.origin || ''} ➔ ${rideInfo?.destination || ''}) was auto-cancelled after 1 hour delay.`,
        { ride_id: booking.ride_id, booking_id: booking.id, type: 'BOOKING_AUTO_CANCELLED' }
      ).catch((e) => console.error('Rider auto-cancel push failed:', e.message));
    }
  });

  console.log('⏱️ Auto-expiry scheduled cron worker initialized for ghost rides (1h auto-cancel).');
};

module.exports = { initCronJobs };