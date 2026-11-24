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

// --- 1. CALCULATE CEILING PREVIEW API ---
router.post('/estimate-ceiling', verifyToken, (req, res) => {
  const {
    distance_km,
    seats_available,
    toll_charges,
    vehicle_type,
    vehicle_category,
    fuel_type,
  } = req.body;

  if (!distance_km || !seats_available) {
    return res.status(400).json({ error: 'distance_km aur seats_available anivarya hain' });
  }

  const breakdown = calculateLegalCeiling(
    distance_km,
    seats_available,
    toll_charges,
    vehicle_type || 'sedan',
    vehicle_category || 'car_5_seater',
    fuel_type || 'petrol'
  );

  return res.status(200).json({ success: true, ceiling: breakdown });
});

// --- 2. PUBLISH RIDE (Idempotent / Anti-Duplicate + Audit Trail + Legal Ceiling) ---
const publishRideHandler = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const driver_id = req.user.id;
    const idempotencyKey =
      req.headers['x-idempotency-key'] || req.body?.idempotency_key || null;

    await client.query('BEGIN');

    // Prevent duplicate insert if same idempotency_key arrives on retry
    if (idempotencyKey) {
      const existingByKey = await client.query(
        `SELECT * FROM rides WHERE idempotency_key = $1 AND driver_id = $2 LIMIT 1`,
        [String(idempotencyKey), driver_id]
      );
      if (existingByKey.rows.length > 0) {
        await client.query('COMMIT');
        return res.status(200).json({
          success: true,
          deduplicated: true,
          message: 'Ride already published.',
          ride: existingByKey.rows[0],
        });
      }
    }

    // Trial Ride & Verification check
    const tripCheckRes = await client.query(
      'SELECT COUNT(*) FROM rides WHERE driver_id = $1 AND status != $2',
      [driver_id, 'cancelled']
    );
    const totalUserRides = parseInt(tripCheckRes.rows[0].count, 10);

    const driverVerifyRes = await client.query(
      'SELECT is_verified FROM users WHERE id = $1',
      [driver_id]
    );
    const isUserVerified = driverVerifyRes.rows[0]?.is_verified;

    if (!isUserVerified && totalUserRides > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error:
          'Driver verification pending. Please complete your ID/DL verification to offer more rides.',
      });
    }

    const {
      origin,
      start_location,
      destination,
      end_location,
      departure_time,
      seats_available,
      total_seats,
      price_per_seat,
      distance_km,
      toll_charges = 0,
      vehicle_type = 'sedan',
      fuel_type = 'petrol',
      vehicle_category = 'car_5_seater',
      luggage_size = 'small',
      is_ac_available = true,
      is_smoking_allowed = false,
      is_pet_friendly = false,
      gender_preference = 'any',
      category_restriction = 'open',
    } = req.body;

    const actualOrigin = origin || start_location;
    const actualDestination = destination || end_location;
    const actualSeats = seats_available || total_seats;

    if (!actualOrigin || !actualDestination || !departure_time || !actualSeats || !price_per_seat) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Sabhi anivarya fields fill karein' });
    }

    const offeredPrice = parseFloat(price_per_seat);
    const parsedSeats = parseInt(actualSeats, 10);
    const parsedDistance = distance_km ? parseFloat(distance_km) : 10;
    const parsedToll = toll_charges ? parseFloat(toll_charges) : 0;

    if (Number.isNaN(offeredPrice) || Number.isNaN(parsedSeats) || parsedSeats < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Valid seats aur price_per_seat dein' });
    }

    // Legal Cost Ceiling Calculation with Dynamic Toll & Fuel Type
    const ceilingInfo = calculateLegalCeiling(
      parsedDistance,
      parsedSeats,
      parsedToll,
      vehicle_type,
      vehicle_category,
      fuel_type
    );

    if (offeredPrice > ceilingInfo.maxAllowedPricePerSeat) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Legal Cost-Recovery Violation: Price ₹${offeredPrice} ceiling limit (₹${ceilingInfo.maxAllowedPricePerSeat}) se zyada hai. Carpooling platform par commercial taxi pricing allowed nahi hai.`,
        max_allowed_price: ceilingInfo.maxAllowedPricePerSeat,
      });
    }

    // Prevent double-click / rapid duplicate ride for same driver, route & departure time
    const duplicateCheck = await client.query(
      `SELECT * FROM rides
       WHERE driver_id = $1
         AND LOWER(TRIM(origin)) = LOWER(TRIM($2))
         AND LOWER(TRIM(destination)) = LOWER(TRIM($3))
         AND status IN ('scheduled', 'in_progress')
         AND ABS(EXTRACT(EPOCH FROM (departure_time - $4::timestamptz))) <= 120
         AND created_at >= NOW() - INTERVAL '60 seconds'
       ORDER BY created_at DESC
       LIMIT 1`,
      [driver_id, actualOrigin, actualDestination, departure_time]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('COMMIT');
      return res.status(200).json({
        success: true,
        deduplicated: true,
        message: 'Duplicate submission prevented; ride already created.',
        ride: duplicateCheck.rows[0],
      });
    }

    // Daily Ride Limit Check
    const tripCountCheck = await client.query(
      `SELECT COUNT(*) FROM rides 
       WHERE driver_id = $1 
       AND DATE(departure_time AT TIME ZONE 'Asia/Kolkata') = DATE($2::timestamptz AT TIME ZONE 'Asia/Kolkata')
       AND status != 'cancelled'`,
      [driver_id, departure_time]
    );

    if (parseInt(tripCountCheck.rows[0].count, 10) >= 3) {
      await client.query('ROLLBACK');
      return res.status(429).json({
        error:
          'Daily trip limit exceeded: Ek din mein adhiktam 3 rides ki anumati hai private vehicle compliance ke liye.',
      });
    }

    const insertQuery = `
      INSERT INTO rides (
        driver_id, origin, destination, departure_time, seats_available, price_per_seat,
        max_price_ceiling, toll_charges, distance_km,
        vehicle_type, fuel_type, vehicle_category, luggage_size, is_ac_available,
        is_smoking_allowed, is_pet_friendly, gender_preference, category_restriction,
        idempotency_key, status
      ) VALUES (
        $1, $2, $3, $4::timestamptz, $5, $6,
        $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, 'scheduled'
      )
      RETURNING *;
    `;

    const result = await client.query(insertQuery, [
      driver_id,
      actualOrigin.trim(),
      actualDestination.trim(),
      departure_time,
      parsedSeats,
      offeredPrice,
      ceilingInfo.maxAllowedPricePerSeat,
      parsedToll,
      parsedDistance,
      vehicle_type,
      fuel_type,
      vehicle_category,
      luggage_size,
      is_ac_available,
      is_smoking_allowed,
      is_pet_friendly,
      gender_preference,
      category_restriction,
      idempotencyKey ? String(idempotencyKey) : null,
    ]);

    await client.query('COMMIT');

    const successMessage =
      totalUserRides === 0
        ? '🎉 Trial ride safaltapoorvak create ho gayi!'
        : 'Ride safaltapoorvak create ho gayi. Ride successfully published with audit trail!';

    return res.status(201).json({
      success: true,
      message: successMessage,
      ride: result.rows[0],
      legal_compliance: {
        cost_ceiling: ceilingInfo.maxAllowedPricePerSeat,
        total_trip_cost: ceilingInfo.totalTripCost,
        toll_included: parsedToll,
        is_compliant: true,
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Create ride error:', error);
    return res.status(500).json({ error: 'Server error: Ride publish fail ho gayi.' });
  } finally {
    client.release();
  }
};

router.post('/', verifyToken, requireDriver, publishRideHandler);
router.post('/offer', verifyToken, requireDriver, publishRideHandler);
router.post('/create', verifyToken, requireDriver, publishRideHandler);

// --- 3. SEARCH RIDES ---
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
        r.origin, r.destination, r.departure_time, r.price_per_seat,
        r.seats_available, r.seats_available AS available_seats,
        r.luggage_size, r.is_ac_available, r.is_smoking_allowed,
        r.is_pet_friendly, r.gender_preference, r.category_restriction, r.status
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.status = 'scheduled'
        AND r.departure_time > NOW()
    `;

    const queryParams = [];

    if (from && String(from).trim()) {
      queryParams.push(`%${String(from).trim().toLowerCase()}%`);
      queryText += ` AND LOWER(r.origin) LIKE $${queryParams.length}`;
    }

    if (to && String(to).trim()) {
      queryParams.push(`%${String(to).trim().toLowerCase()}%`);
      queryText += ` AND LOWER(r.destination) LIKE $${queryParams.length}`;
    }

    if (date && String(date).trim()) {
      queryParams.push(String(date).trim());
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

    const rideCheck = await client.query(`SELECT * FROM rides WHERE id = $1 FOR UPDATE`, [rideId]);

    if (rideCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride not found.' });
    }

    const ride = rideCheck.rows[0];

    if (String(ride.driver_id) === String(riderId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'You cannot book your own ride.' });
    }

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
        ride_id, rider_id, seats_booked, total_payable_amount, ride_otp, booking_status, payment_status
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

// --- 5. GET RIDES CREATED BY DRIVER ---
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

// --- 6. EDIT SCHEDULED RIDE (Allowed ONLY if status is 'scheduled' AND zero seats booked) ---
router.patch('/:id', verifyToken, requireDriver, async (req, res) => {
  const rideId = req.params.id;
  const driverId = req.user.id;
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const rideRes = await client.query(`SELECT * FROM rides WHERE id = $1 FOR UPDATE`, [rideId]);

    if (rideRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride not found.' });
    }

    const ride = rideRes.rows[0];

    if (String(ride.driver_id) !== String(driverId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'You are not authorized to edit this ride.' });
    }

    if (String(ride.status).toLowerCase() !== 'scheduled') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Only scheduled rides can be edited. Current status: ${ride.status}.`,
      });
    }

    // Block editing if any seat is already booked
    const bookingCheck = await client.query(
      `SELECT COALESCE(SUM(seats_booked), 0)::int AS booked_seats,
              COUNT(*)::int AS active_bookings
       FROM bookings
       WHERE ride_id = $1 AND booking_status = 'confirmed'`,
      [rideId]
    );

    const bookedSeats = bookingCheck.rows[0]?.booked_seats || 0;
    const activeBookings = bookingCheck.rows[0]?.active_bookings || 0;

    if (bookedSeats > 0 || activeBookings > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Cannot edit ride details once a seat has been booked.',
      });
    }

    const {
      origin,
      start_location,
      destination,
      end_location,
      departure_time,
      seats_available,
      total_seats,
      price_per_seat,
      distance_km,
      toll_charges,
      vehicle_type,
      fuel_type,
      vehicle_category,
      luggage_size,
      is_ac_available,
      is_smoking_allowed,
      is_pet_friendly,
      gender_preference,
      category_restriction,
    } = req.body;

    const nextOrigin = String(origin || start_location || ride.origin || '').trim();
    const nextDestination = String(destination || end_location || ride.destination || '').trim();
    const nextDeparture = departure_time || ride.departure_time;
    const nextSeats =
      seats_available !== undefined || total_seats !== undefined
        ? parseInt(seats_available ?? total_seats, 10)
        : parseInt(ride.seats_available, 10);
    const nextPrice =
      price_per_seat !== undefined ? parseFloat(price_per_seat) : parseFloat(ride.price_per_seat);

    if (
      !nextOrigin ||
      !nextDestination ||
      !nextDeparture ||
      Number.isNaN(nextSeats) ||
      nextSeats < 1 ||
      Number.isNaN(nextPrice) ||
      nextPrice < 0
    ) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid ride details provided.' });
    }

    const nextDistance =
      distance_km !== undefined ? parseFloat(distance_km) : parseFloat(ride.distance_km || 10);
    const nextToll =
      toll_charges !== undefined ? parseFloat(toll_charges) : parseFloat(ride.toll_charges || 0);
    const nextVehicleType = vehicle_type || ride.vehicle_type || 'sedan';
    const nextFuelType = fuel_type || ride.fuel_type || 'petrol';
    const nextVehicleCategory = vehicle_category || ride.vehicle_category || 'car_5_seater';

    const ceilingInfo = calculateLegalCeiling(
      nextDistance,
      nextSeats,
      nextToll,
      nextVehicleType,
      nextVehicleCategory,
      nextFuelType
    );

    if (nextPrice > ceilingInfo.maxAllowedPricePerSeat) {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: `Price ₹${nextPrice} exceeds legal cost-recovery ceiling (₹${ceilingInfo.maxAllowedPricePerSeat}).`,
        max_allowed_price: ceilingInfo.maxAllowedPricePerSeat,
      });
    }

    const updateQuery = `
      UPDATE rides
      SET origin = $1,
          destination = $2,
          departure_time = $3::timestamptz,
          seats_available = $4,
          price_per_seat = $5,
          max_price_ceiling = $6,
          toll_charges = $7,
          distance_km = $8,
          vehicle_type = $9,
          fuel_type = $10,
          vehicle_category = $11,
          luggage_size = $12,
          is_ac_available = $13,
          is_smoking_allowed = $14,
          is_pet_friendly = $15,
          gender_preference = $16,
          category_restriction = $17,
          updated_at = NOW()
      WHERE id = $18 AND driver_id = $19
      RETURNING *;
    `;

    const updated = await client.query(updateQuery, [
      nextOrigin,
      nextDestination,
      nextDeparture,
      nextSeats,
      nextPrice,
      ceilingInfo.maxAllowedPricePerSeat,
      nextToll,
      nextDistance,
      nextVehicleType,
      nextFuelType,
      nextVehicleCategory,
      luggage_size ?? ride.luggage_size ?? 'small',
      is_ac_available ?? ride.is_ac_available ?? true,
      is_smoking_allowed ?? ride.is_smoking_allowed ?? false,
      is_pet_friendly ?? ride.is_pet_friendly ?? false,
      gender_preference ?? ride.gender_preference ?? 'any',
      category_restriction ?? ride.category_restriction ?? 'open',
      rideId,
      driverId,
    ]);

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Ride details updated successfully.',
      ride: updated.rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Edit ride error:', err.message);
    return res.status(500).json({ error: 'Failed to update ride details.' });
  } finally {
    client.release();
  }
});

module.exports = router;