// services/cronService.js
const cron = require('node-cron');
const db = require('../config/db');

const initCronJobs = () => {
  // Har 5 minute mein check karega (*/5 * * * *)
  cron.schedule('*/5 * * * *', async () => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Aisi rides dhundein jo departure time ke 30 min baad bhi 'scheduled' hain
      const expiredRidesQuery = `
        SELECT id FROM rides 
        WHERE status = 'scheduled' 
          AND departure_time < (NOW() - INTERVAL '30 minutes')
        FOR UPDATE SKIP LOCKED;
      `;
      const { rows: expiredRides } = await client.query(expiredRidesQuery);

      if (expiredRides.length > 0) {
        const rideIds = expiredRides.map((r) => r.id);

        // 2. Rides ko 'cancelled' mark karein
        await client.query(
          `UPDATE rides 
           SET status = 'cancelled', updated_at = NOW() 
           WHERE id = ANY($1::uuid[])`,
          [rideIds]
        );

        // 3. Un rides ki active bookings ko bhi cancel mark karein
        await client.query(
          `UPDATE bookings 
           SET booking_status = 'cancelled', updated_at = NOW() 
           WHERE ride_id = ANY($1::uuid[]) AND booking_status = 'confirmed'`,
          [rideIds]
        );

        console.log(`[Auto-Expiry Cron] ${rideIds.length} expired rides automatically cancelled.`);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[Auto-Expiry Cron Error]:', err.message);
    } finally {
      client.release();
    }
  });

  console.log('⏱️ Auto-expiry scheduled cron worker initialized.');
};

module.exports = { initCronJobs };