// routes/rides.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, requireDriver } = require('../middlewares/auth');
const { calculateLegalCeiling } = require('../utils/pricingCeiling');

// --- 0. GET ALL ACTIVE RIDES (Default explore feed) ---
router.get('/', async (req, res) => {
  try {
    const queryText = `
      SELECT 
        r.id, r.driver_id, u.name AS driver_name,
        COALESCE(
          (SELECT ROUND(AVG(rev.rating)::numeric, 1) 
           FROM reviews rev WHERE rev.reviewed_user_id = u.id),
          5.0
        ) AS driver_rating,
        r.origin, r.destination, r.departure_time, r.price_per_seat,
        r.seats_available, r.seats_available AS available_seats,
        r.vehicle_category, r.luggage_size, r.is_ac_available,
        r.is_smoking_allowed, r.is_pet_friendly, r.gender_preference,
        r.category_restriction, r.status
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.status = 'scheduled' AND r.departure_time > NOW()
      ORDER BY r.departure_time ASC;
    `;
    const { rows } = await db.query(queryText);
    return res.status(200).json(rows);
  } catch (error) {
    console.error('Fetch all rides error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch rides feed' });
  }
});

// 1. Calculate Ceiling Preview API (Frontend live estimate)
router.post('/estimate-ceiling', verifyToken, (req, res) => {
  const { distance_km, seats_available, toll_charges, vehicle_type, vehicle_category } = req.body;

  if (!distance_km || !seats_available) {
    return res.status(400).json({ error: 'distance_km aur seats_available anivarya hain' });
  }

  const breakdown = calculateLegalCeiling(
    distance_km, seats_available, toll_charges,
    vehicle_type, vehicle_category
  );

  return res.status(200).json({ success: true, ceiling: breakdown });
});

// 2. Publish Ride (Merged: Handles Legal Pricing +Timezone Safe + Multi-Vehicle Metadata + Trial Ride Check)

router.post('/', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const driver_id = req.user.id;

    // 💡 1. Check karein ki driver ki pehle se kitni rides bani hain (Trial Ride check)
    const tripCheckRes = await client.query(
      'SELECT COUNT(*) FROM rides WHERE driver_id = $1',
      [driver_id]
    );
    const totalUserRides = parseInt(tripCheckRes.rows[0].count, 10);

    // 💡 2. Driver ka verification status check karein
    const driverVerifyRes = await client.query(
      'SELECT is_verified FROM users WHERE id = $1',
      [driver_id]
    );
    const isUserVerified = driverVerifyRes.rows[0]?.is_verified;

    // 💡 3. Agar verified nahi hai AUR yeh pehli ride bhi nahi hai, tab block karein
    if (!isUserVerified && totalUserRides > 0) {
      return res.status(403).json({
        error: 'Driver verification pending. Please complete your ID/DL verification to offer more rides.'
      });
    }

    // Frontend payload se exact fields destructure kar rahe hain
    const {
      origin, start_location, destination, end_location, departure_time, 
      seats_available, total_seats, price_per_seat,
      distance_km = 10, // Default for testing if frontend doesn't send yet
      toll_charges = 0,
      vehicle_type = 'default', vehicle_category = 'car_5_seater',
      luggage_size = 'small',
      is_ac_available = true,
      is_smoking_allowed = false,
      is_pet_friendly = false, 
      gender_preference = 'all',
      category_restriction = 'open'
    } = req.body;

    // Validation
    const actualOrigin = origin || start_location;
    const actualDestination = destination || end_location;
    const actualSeats = seats_available || total_seats;

    if (!actualOrigin || !actualDestination || !departure_time || !actualSeats || !price_per_seat || !distance_km) {
      return res.status(400).json({ error: 'Sabhi anivarya fields fill karein' });
    }

    const offeredPrice = parseFloat(price_per_seat);
    const parsedSeats = parseInt(actualSeats, 10);
    const parsedDistance = parseFloat(distance_km);

    // Legal Cost Ceiling Check
    const ceilingInfo = calculateLegalCeiling(parsedDistance, parsedSeats, toll_charges, vehicle_type, vehicle_category);
    if (offeredPrice > ceilingInfo.maxAllowedPricePerSeat) {
      return res.status(422).json({
        error: `Legal Cost-Recovery Violation: Price ₹${offeredPrice} ceiling limit (₹${ceilingInfo.maxAllowedPricePerSeat}) se zyada hai. Carpooling platform par commercial taxi pricing allowed nahi hai.`,
        max_allowed_price: ceilingInfo.maxAllowedPricePerSeat,
      });
    }

    // Daily Ride Limit (Private vehicle compliance)
    const tripCountCheck = await client.query(
      `SELECT COUNT(*) FROM rides 
       WHERE driver_id = $1 
       AND DATE(departure_time AT TIME ZONE 'Asia/Kolkata') = DATE($2::timestamptz AT TIME ZONE 'Asia/Kolkata')
       AND status != 'cancelled'`,
      [driver_id, departure_time]
    );

    if (parseInt(tripCountCheck.rows[0].count, 10) >= 3) {
      return res.status(429).json({
        error: 'Daily trip limit exceeded: Ek din mein adhiktam 3 rides ki anumati hai private vehicle compliance ke liye.',
      });
    }

    await client.query('BEGIN');

    // Insert into DB 
    const insertQuery = `
      INSERT INTO rides (
        driver_id, origin, destination, departure_time, seats_available, price_per_seat, 
        max_price_ceiling, toll_charges,
        vehicle_category, luggage_size, is_ac_available,
        is_smoking_allowed, is_pet_friendly, gender_preference, category_restriction, status
      ) VALUES ($1, $2, $3, $4::timestamptz, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'scheduled')
      RETURNING *;
    `;

    const result = await client.query(insertQuery, [
      driver_id, actualOrigin.trim(), actualDestination.trim(), departure_time, parsedSeats, offeredPrice,
      ceilingInfo.maxAllowedPricePerSeat, toll_charges,
      vehicle_category, luggage_size, is_ac_available, 
      is_smoking_allowed, is_pet_friendly, gender_preference, category_restriction,
    ]);

    await client.query('COMMIT');

    const successMessage = totalUserRides === 0 
      ? '🎉 Trial ride safaltapoorvak create ho gayi!' 
      : 'Ride safaltapoorvak create ho gayi. Ride successfully published!';

    return res.status(201).json({
      success: true,
      message: successMessage,
      ride: result.rows[0],
      legal_compliance: {
        cost_ceiling: ceilingInfo.maxAllowedPricePerSeat,
        is_compliant: true,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create ride error:', error);
    return res.status(500).json({ error: 'Server error: Ride publish fail ho gayi. Ride create karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

// Backward compatibility aliases
router.post('/offer', verifyToken, requireDriver, (req, res, next) => { req.url = '/'; router.handle(req, res, next);});
router.post('/create', (req, res, next) => { req.url = '/'; router.handle(req, res, next); });
router.post('/offer', (req, res, next) => { req.url = '/'; router.handle(req, res, next); });


// --- 3. SEARCH RIDES (Timezone-Safe IST Search) ---
router.get('/search', async (req, res) => {
  try {
    const { from, to, date, seats, gender, category } = req.query;
    const requiredSeats = parseInt(seats, 10) || 1;

    let queryText = `
      SELECT 
        r.*, u.name AS driver_name,
        COALESCE(
          (SELECT ROUND(AVG(rev.rating)::numeric, 1) 
           FROM reviews rev 
           WHERE rev.reviewed_user_id = u.id),
          5.0
        ) AS driver_rating,
        r.origin,
        r.destination,
        r.departure_time,
        r.price_per_seat,
        r.seats_available,
        r.seats_available AS available_seats,
        r.luggage_size,
        r.is_ac_available,
        r.is_smoking_allowed,
        r.is_pet_friendly,
        r.gender_preference,
        r.category_restriction,
        r.status
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.status = 'scheduled'
        AND r.departure_time > NOW()
    `;

    const queryParams = [];

    // if (from) { queryParams.push(`%${from.trim().toLowerCase()}%`); queryText += ` AND LOWER(r.origin) LIKE $${queryParams.length}`; }
    // if (to) { queryParams.push(`%${to.trim().toLowerCase()}%`); queryText += ` AND LOWER(r.destination) LIKE $${queryParams.length}`; }
    // if (date) { queryParams.push(date.trim()); queryText += ` AND TO_CHAR(r.departure_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${queryParams.length}`; }
    // if (gender && gender !== 'all') { queryParams.push(gender); queryText += ` AND r.gender_preference IN ('all', $${queryParams.length})`; }
    // if (category && category !== 'open') { queryParams.push(category); queryText += ` AND r.category_restriction IN ('open', $${queryParams.length})`; }

    if (from && from.trim()) {
      queryParams.push(`%${from.trim().toLowerCase()}%`);
      queryText += ` AND LOWER(r.origin) LIKE $${queryParams.length}`;
    }

    if (to && to.trim()) {
      queryParams.push(`%${to.trim().toLowerCase()}%`);
      queryText += ` AND LOWER(r.destination) LIKE $${queryParams.length}`;
    }

    if (date && date.trim()) {
      queryParams.push(date.trim());
      queryText += ` AND TO_CHAR(r.departure_time AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') = $${queryParams.length}`;
    }

    if (gender && gender !== 'all') {
      queryParams.push(gender);
      queryText += ` AND (r.gender_preference = 'all' OR r.gender_preference = $${queryParams.length})`;
    }

    if (category && category !== 'open') {
      queryParams.push(category);
      queryText += ` AND (r.category_restriction = 'open' OR r.category_restriction = $${queryParams.length})`;
    }

    queryParams.push(requiredSeats);
    queryText += ` AND r.seats_available >= $${queryParams.length}`;
    queryText += ` ORDER BY r.departure_time ASC`;

    const { rows } = await db.query(queryText, queryParams);
    return res.status(200).json({ success: true, count: rows.length, rides: rows });
  } catch (error) {
    console.error('Ride search failed:', error.message);
    return res.status(500).json({ error: 'Search failed due to internal server error.' });
  }
});

// --- 4. BOOK A RIDE ---
router.post('/:id/book', verifyToken, async (req, res) => {
  const rideId = req.params.id;
  const riderId = req.user.id;
  const { seats_requested = 1 } = req.body;
  const seatsNum = parseInt(seats_requested, 10) || 1;

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const rideCheck = await client.query(
      `SELECT * FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId]
    );

    if (rideCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride not found.' });
    }

    const ride = rideCheck.rows[0];

    if (ride.status !== 'scheduled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This ride is no longer active for booking.' });
    }

    if (ride.seats_available < seatsNum) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sorry, not enough seats available!' });
    }

    await client.query(
      `UPDATE rides 
       SET seats_available = seats_available - $1 
       WHERE id = $2`,
      [seatsNum, rideId]
    );

    const rideOtp = Math.floor(1000 + Math.random() * 9000).toString();
    const totalFare = parseFloat(ride.price_per_seat) * seatsNum;

    const bookingResult = await client.query(
      `INSERT INTO bookings (
        ride_id, 
        rider_id, 
        seats_booked, 
        total_payable_amount, 
        ride_otp, 
        booking_status, 
        payment_status
      ) VALUES ($1, $2, $3, $4, $5, 'confirmed', 'pending')
      RETURNING *`,
      [rideId, riderId, seatsNum, totalFare, rideOtp]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Seats booked successfully!',
      booking: bookingResult.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Booking Transaction Error:', err.message);
    return res.status(500).json({ error: 'Server Error during booking transaction' });
  } finally {
    client.release();
  }
});


// --- 6. GET RIDES CREATED BY DRIVER ---
router.get('/driver/:driverId', verifyToken, async (req, res) => {
  try {
    const { driverId } = req.params;
    const rides = await db.query(
      `SELECT 
        r.*,
        COALESCE(
          json_agg(
            json_build_object(
              'booking_id', b.id,
              'rider_name', u.name,
              'seats_booked', b.seats_booked,
              'booking_status', b.booking_status,
              'is_otp_verified', b.is_otp_verified
            )
          ) FILTER (WHERE b.id IS NOT NULL), '[]'
        ) AS passengers
       FROM rides r
       LEFT JOIN bookings b ON r.id = b.ride_id AND b.booking_status = 'confirmed'
       LEFT JOIN users u ON b.rider_id = u.id
       WHERE r.driver_id = $1 
       GROUP BY r.id
       ORDER BY r.departure_time DESC`,
      [driverId]
    );

    return res.status(200).json({ success: true, rides: rides.rows });
  } catch (err) {
    console.error('Database Error:', err.message);
    return res.status(500).json({ error: 'Server Error fetching driver rides.' });
  }
});

// --- 5. GET RIDER'S BOOKINGS ---
router.get('/user/:userId/bookings', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const queryText = `
      SELECT 
        b.id AS booking_id,
        b.seats_booked,
        b.booking_status,
        b.payment_status,
        b.total_payable_amount,
        b.ride_otp,
        b.created_at,
        r.id AS ride_id,
        r.origin,
        r.destination,
        r.departure_time,
        r.price_per_seat,
        r.status AS ride_status,
        u.name AS driver_name,
        u.phone AS driver_phone
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      JOIN users u ON r.driver_id = u.id
      WHERE b.rider_id = $1
      ORDER BY r.departure_time DESC
    `;

    const { rows } = await db.query(queryText, [userId]);
    return res.status(200).json({ success: true, bookings: rows });
  } catch (error) {
    console.error('Error fetching user bookings:', error.message);
    return res.status(500).json({ error: 'Failed to fetch booked rides.' });
  }
});

// --- 7. CANCEL A BOOKING ---
router.post('/bookings/:bookingId/cancel', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { bookingId } = req.params;
    const riderId = req.user.id;

    await client.query('BEGIN');

    const bookingRes = await client.query(
      `SELECT * FROM bookings WHERE id = $1 AND rider_id = $2 FOR UPDATE`,
      [bookingId, riderId]
    );

    if (bookingRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found or unauthorized.' });
    }

    const booking = bookingRes.rows[0];

    if (booking.booking_status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Booking is already cancelled.' });
    }

    await client.query(
      `UPDATE rides 
       SET seats_available = seats_available + $1 
       WHERE id = $2`,
      [booking.seats_booked, booking.ride_id]
    );

    await client.query(
      `UPDATE bookings 
       SET booking_status = 'cancelled' 
       WHERE id = $1`,
      [bookingId]
    );

    await client.query('COMMIT');
    return res.status(200).json({ success: true, message: 'Booking cancelled.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Cancellation error:', error.message);
    return res.status(500).json({ error: 'Failed to cancel booking.' });
  } finally {
    client.release();
  }
});

// --- 8. VERIFY OTP & START RIDE (Driver Side) ---
router.post('/bookings/:bookingId/verify-start-otp', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { bookingId } = req.params;
    const { otp } = req.body;
    const driverId = req.user.id;

    if (!otp) {
      return res.status(400).json({ error: 'Kripya 4-digit OTP enter karein.' });
    }

    await client.query('BEGIN');

    // Booking aur associated ride ki details fetch karein taaki driver verify ho sake
    const queryText = `
      SELECT 
        b.id AS booking_id,
        b.ride_otp,
        b.booking_status,
        b.is_otp_verified,
        r.id AS ride_id,
        r.driver_id,
        r.status AS ride_status
      FROM bookings b
      JOIN rides r ON b.ride_id = r.id
      WHERE b.id = $1 FOR UPDATE
    `;

    const { rows } = await client.query(queryText, [bookingId]);

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking nahi mili.' });
    }

    const booking = rows[0];

    // Check karein ki request bhejne wala driver hi is ride ka owner hai
    if (booking.driver_id !== driverId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Aap is ride ke driver nahi hain.' });
    }

    if (booking.booking_status !== 'confirmed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Yeh booking active ya confirmed nahi hai.' });
    }

    if (booking.is_otp_verified) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Yeh OTP pehle hi verify ho chuka hai.' });
    }

    // OTP Match check
    if (booking.ride_otp !== otp.toString().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Galat OTP enter kiya gaya hai. Passenger se dobara puchein.' });
    }

    // Booking ko verified mark karein aur ride status ko 'active' update karein
    await client.query(
      `UPDATE bookings SET is_otp_verified = TRUE, booking_status = 'ongoing' WHERE id = $1`,
      [bookingId]
    );

    await client.query(
      `UPDATE rides SET status = 'active' WHERE id = $1`,
      [booking.ride_id]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'OTP verified successfully! Trip shuru ho chuki hai.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Verify start OTP error:', error.message);
    return res.status(500).json({ error: 'Server error during OTP verification' });
  } finally {
    client.release();
  }
});


// router.post('/bookings/:bookingId/verify-start-otp', verifyToken, requireDriver, async (req, res) => {
//   const client = await db.pool.connect();
//   try {
//     if (!req.body.otp) throw new Error('Kripya 4-digit OTP enter karein.');
//     await client.query('BEGIN');
    
//     const { rows } = await client.query(`SELECT b.*, r.driver_id, r.status AS ride_status FROM bookings b JOIN rides r ON b.ride_id = r.id WHERE b.id = $1 FOR UPDATE`, [req.params.bookingId]);
//     if (rows.length === 0) throw new Error('Booking nahi mili.');
    
//     const booking = rows[0];
//     if (booking.driver_id !== req.user.id) throw new Error('Aap is ride ke driver nahi hain.');
//     if (booking.booking_status !== 'confirmed' || booking.is_otp_verified) throw new Error('Invalid booking state ya OTP verified.');
//     if (booking.ride_otp !== req.body.otp.toString().trim()) throw new Error('Galat OTP.');

//     await client.query(`UPDATE bookings SET is_otp_verified = TRUE, booking_status = 'ongoing' WHERE id = $1`, [req.params.bookingId]);
//     await client.query(`UPDATE rides SET status = 'in_progress' WHERE id = $1`, [booking.ride_id]);

//     await client.query('COMMIT');
//     return res.status(200).json({ success: true, message: 'OTP verified! Trip shuru ho chuki hai.' });
//   } catch (error) {
//     await client.query('ROLLBACK');
//     return res.status(400).json({ error: error.message || 'Server error' });
//   } finally {
//     client.release();
//   }
// });

module.exports = router;