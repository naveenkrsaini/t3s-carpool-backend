// routes/paymentRoutes.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// Razorpay Instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
  key_secret: process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_placeholder',
});

// 1. Create Payment Order for Booking
router.post('/create-order', verifyToken, async (req, res) => {
  try {
    const { booking_id } = req.body;
    const userId = req.user.id;

    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id anivarya hai' });
    }

    // Booking fetch karein
    const bookingResult = await db.query(
      `SELECT id, rider_id, total_payable_amount, payment_status, booking_status 
       FROM bookings 
       WHERE id = $1`,
      [booking_id]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking nahi mili' });
    }

    const booking = bookingResult.rows[0];

    if (booking.rider_id !== userId) {
      return res.status(403).json({ error: 'Aap is booking ke liye unauthorized hain' });
    }

    if (booking.payment_status === 'completed') {
      return res.status(400).json({ error: 'Yeh booking pehle hi paid hai' });
    }

    const amountInPaise = Math.round(parseFloat(booking.total_payable_amount) * 100);

    // Razorpay Order Creation
    const options = {
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${booking_id.substring(0, 10)}`,
      notes: {
        booking_id: booking.id,
        user_id: userId,
      },
    };

    const order = await razorpay.orders.create(options);

    return res.status(200).json({
      success: true,
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_placeholder',
    });
  } catch (error) {
    console.error('Order creation error:', error);
    return res.status(500).json({ error: 'Payment order banate waqt error aaya' });
  }
});

// 2. Verify Payment Signature & Complete Booking Payment
router.post('/verify-payment', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { booking_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!booking_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Payment verification details missing hain' });
    }

    // HMAC SHA256 Signature Verification
    const generatedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET || 'rzp_secret_placeholder')
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature. Verification failed.' });
    }

    await client.query('BEGIN');

    // Update Booking Payment Status
    const updateResult = await client.query(
      `UPDATE bookings 
       SET payment_status = 'completed',
           payment_mode = 'online',
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [booking_id]
    );

    // Admin Audit Log Record
    await client.query(
      `INSERT INTO admin_audit_logs (
        action_type, target_user_id, notes
      ) VALUES ('PAYMENT_COMPLETED', $1, $2)`,
      [
        req.user.id,
        `Payment successful for booking ${booking_id}. Razorpay Payment ID: ${razorpay_payment_id}`,
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Payment safaltapoorvak verify aur complete ho gaya hai.',
      booking: updateResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Payment verify error:', error);
    return res.status(500).json({ error: 'Payment verify karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

// 3. Generate Dynamic UPI String & QR Data
router.post('/generate-upi-qr', verifyToken, async (req, res) => {
  try {
    const { booking_id } = req.body;
    const userId = req.user.id;

    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id anivarya hai' });
    }

    const { rows } = await db.query(
      `SELECT id, rider_id, total_payable_amount, payment_status 
       FROM bookings 
       WHERE id = $1`,
      [booking_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking nahi mili' });
    }

    const booking = rows[0];

    if (booking.rider_id !== userId) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    if (booking.payment_status === 'completed') {
      return res.status(400).json({ error: 'Yeh booking pehle hi paid ho chuki hai' });
    }

    const payeeVpa = process.env.MERCHANT_UPI_ID || 'carpoolmerchant@okaxis';
    const payeeName = 'Carpool Commute';
    const amount = parseFloat(booking.total_payable_amount).toFixed(2);
    const transactionRef = `TXN${booking.id.replace(/-/g, '').substring(0, 12).toUpperCase()}`;

    // NPCI Standard UPI Deep-link URI
    const upiUri = `upi://pay?pa=${payeeVpa}&pn=${encodeURIComponent(payeeName)}&am=${amount}&cu=INR&tr=${transactionRef}&tn=${encodeURIComponent(`Payment for Ride ${booking.id.substring(0, 8)}`)}`;

    return res.status(200).json({
      success: true,
      booking_id: booking.id,
      amount,
      payee_upi_id: payeeVpa,
      transaction_ref: transactionRef,
      upi_intent_uri: upiUri, // Direct UPI App open karne aur QR code SVG generate karne ke liye
    });
  } catch (error) {
    console.error('UPI QR Generation Error:', error);
    return res.status(500).json({ error: 'UPI string create karne mein error aaya' });
  }
});

module.exports = router;