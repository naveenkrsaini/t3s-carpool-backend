// routes/couponRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');
const { evaluateCouponDiscount } = require('../utils/couponEngine');

// 1. Validate & Apply Coupon Preview
router.post('/apply', verifyToken, async (req, res) => {
  try {
    const { code, booking_amount } = req.body;

    if (!code || !booking_amount) {
      return res.status(400).json({ error: 'code aur booking_amount anivarya hain' });
    }

    const { rows } = await db.query(
      `SELECT * FROM coupons 
       WHERE UPPER(code) = UPPER($1) 
       AND is_active = true`,
      [code.trim()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Amanaya (Invalid) ya inactive coupon code.' });
    }

    const coupon = rows[0];
    const evaluation = evaluateCouponDiscount(coupon, booking_amount);

    if (!evaluation.isValid) {
      return res.status(422).json({ error: evaluation.reason });
    }

    return res.status(200).json({
      success: true,
      coupon_code: coupon.code,
      discount_amount: evaluation.discountAmount,
      final_payable: evaluation.finalPayable,
      message: `Coupon '${coupon.code}' safaltapoorvak apply ho gaya hai!`,
    });
  } catch (error) {
    console.error('Coupon apply error:', error);
    return res.status(500).json({ error: 'Coupon validate karne mein server error aaya' });
  }
});

// 2. List All Active Public Coupons
router.get('/active', verifyToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT code, discount_type, discount_value, max_discount_amount, min_booking_amount, valid_until 
       FROM coupons 
       WHERE is_active = true 
       AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY created_at DESC`
    );

    return res.status(200).json({ success: true, coupons: rows });
  } catch (error) {
    console.error('Fetch coupons error:', error);
    return res.status(500).json({ error: 'Coupons fetch karne mein error aaya' });
  }
});

module.exports = router;