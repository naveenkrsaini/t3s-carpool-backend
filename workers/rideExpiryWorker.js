// workers/rideExpiryWorker.js
const cron = require('node-cron');
const db = require('../config/db');

const startRideExpiryCron = () => {
  // Yeh cron job har ghante (every hour at minute 0) run karegi
  // cron format: '0 * * * *'
  cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Auto-Expiry check running for ghost rides...');
    const client = await db.pool.connect();
    
    try {
      await client.query('BEGIN');

      // 1. Un scheduled rides ko dhundho jinka departure time 2 ghante pehle nikal chuka hai
      const updateRidesQuery = `
        UPDATE rides
        SET status = 'cancelled', updated_at = NOW()
        WHERE status = 'scheduled' 
          AND departure_time < NOW() - INTERVAL '2 hours'
        RETURNING id;
      `;
      
      const { rows: expiredRides } = await client.query(updateRidesQuery);

      if (expiredRides.length > 0) {
        const rideIds = expiredRides.map(r => r.id);
        
        // 2. Un rides ki sabhi confirmed bookings ko bhi cancel kar do
        const updateBookingsQuery = `
          UPDATE bookings
          SET booking_status = 'cancelled'
          WHERE ride_id = ANY($1) AND booking_status = 'confirmed'
        `;
        await client.query(updateBookingsQuery, [rideIds]);

        console.log(`[CRON] Successfully expired ${expiredRides.length} inactive rides.`);
      } else {
        console.log('[CRON] No Inactive Rides Found. System cleaned.');
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[CRON ERROR] Ride expiry cron failed:', error.message);
    } finally {
      client.release();
    }
  });
};

module.exports = { startRideExpiryCron };