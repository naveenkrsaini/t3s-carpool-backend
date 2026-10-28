const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// 1. Create Booking with Fare Calculation & 4-Digit Boarding OTP
router.post('/book', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { ride_id, seats_booked = 1, coupon_code, payment_mode = 'cash_on_ride' } = req.body;
    const rider_id = req.user.id;

    if (!ride_id) {
      return res.status(400).json({ error: 'ride_id anivarya hai' });
    }

    if (seats_booked < 1) {
      return res.status(400).json({ error: 'Kam se kam 1 seat book karni hogi' });
    }

    await client.query('BEGIN');

    // Concurrency Lock: Ride row lock with FOR UPDATE
    const rideResult = await client.query(
      `SELECT id, driver_id, seats_available, price_per_seat, status 
       FROM rides 
       WHERE id = $1 
       FOR UPDATE`,
      [ride_id]
    );

    if (rideResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride nahi mili' });
    }

    const ride = rideResult.rows[0];

    if (ride.driver_id === rider_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aap apni hi ride book nahi kar sakte' });
    }

    if (ride.status !== 'scheduled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Ride abhi booking ke liye uplabdh nahi hai (Status: ${ride.status})` });
    }

    if (ride.seats_available < seats_booked) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Keval ${ride.seats_available} seat(s) uplabdh hain` });
    }

    // Fare calculation
    const base_amount = parseFloat(ride.price_per_seat) * seats_booked;
    const platform_fee = Math.round(base_amount * 0.08 * 100) / 100; // 8% Platform fee
    const tax_amount = Math.round((base_amount + platform_fee) * 0.05 * 100) / 100; // 5% GST
    let discount_amount = 0.00;
    let coupon_id = null;

    // Optional Coupon Validation
    if (coupon_code) {
      const couponResult = await client.query(
        `SELECT id, discount_type, discount_value, max_discount, min_ride_amount, valid_until, is_active 
         FROM coupons 
         WHERE code = $1 AND is_active = TRUE AND valid_until > NOW()`,
        [coupon_code.trim().toUpperCase()]
      );

      if (couponResult.rows.length > 0) {
        const coupon = couponResult.rows[0];
        if (base_amount >= parseFloat(coupon.min_ride_amount)) {
          coupon_id = coupon.id;
          if (coupon.discount_type === 'flat') {
            discount_amount = parseFloat(coupon.discount_value);
          } else if (coupon.discount_type === 'percentage') {
            const rawDiscount = (base_amount * parseFloat(coupon.discount_value)) / 100;
            discount_amount = coupon.max_discount ? Math.min(rawDiscount, parseFloat(coupon.max_discount)) : rawDiscount;
          }
          discount_amount = Math.min(discount_amount, base_amount + platform_fee + tax_amount);
        }
      }
    }

    const total_payable_amount = Math.max(0, Math.round((base_amount + platform_fee + tax_amount - discount_amount) * 100) / 100);
    const is_free_ride = total_payable_amount === 0;

    // Secure Random 4-Digit Ride Start OTP
    const ride_otp = Math.floor(1000 + Math.random() * 9000).toString();

    // Insert Booking Record
    const bookingInsertQuery = `
      INSERT INTO bookings (
        ride_id, rider_id, seats_booked, booking_status, ride_otp,
        base_amount, platform_fee, tax_amount, discount_amount, total_payable_amount,
        coupon_id, is_free_ride, payment_mode, payment_status
      )
      VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
      RETURNING id, ride_id, rider_id, seats_booked, booking_status, ride_otp, total_payable_amount, booked_at;
    `;

    const bookingResult = await client.query(bookingInsertQuery, [
      ride_id,
      rider_id,
      seats_booked,
      ride_otp,
      base_amount,
      platform_fee,
      tax_amount,
      discount_amount,
      total_payable_amount,
      coupon_id,
      is_free_ride,
      payment_mode,
    ]);

    // Update available seats on ride
    await client.query(
      `UPDATE rides 
       SET seats_available = seats_available - $1 
       WHERE id = $2`,
      [seats_booked, ride_id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Booking safaltapoorvak confirm ho gayi hai',
      booking: bookingResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Booking error:', error);
    return res.status(500).json({ error: 'Booking process karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

// 2. Get Rider's My Bookings List
router.get('/my-bookings', verifyToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT 
          b.id AS booking_id,
          b.seats_booked,
          b.booking_status,
          b.ride_otp,
          b.total_payable_amount,
          b.payment_mode,
          b.payment_status,
          b.booked_at,
          r.id AS ride_id,
          r.origin,
          r.destination,
          r.departure_time,
          r.status AS ride_status,
          u.name AS driver_name,
          u.phone AS driver_phone
       FROM bookings b
       JOIN rides r ON b.ride_id = r.id
       JOIN users u ON r.driver_id = u.id
       WHERE b.rider_id = $1
       ORDER BY b.booked_at DESC`,
      [req.user.id]
    );

    return res.status(200).json({ bookings: rows });
  } catch (error) {
    console.error('My bookings error:', error);
    return res.status(500).json({ error: 'Bookings list fetch karne me error aaya' });
  }
});

module.exports = router;