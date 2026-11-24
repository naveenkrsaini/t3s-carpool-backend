// routes/couponRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');
const { evaluateCouponDiscount } = require('../utils/couponEngine');

const DEFAULT_FESTIVE_POSTERS = [
  {
    id: 'poster-festive-commute',
    title: 'Festive & Holiday Commute Special',
    subtitle: 'Share rides during holidays & festivals with extra savings',
    badge: 'FESTIVE OFFER',
    code: 'FESTIVE20',
    tag: 'GIFT CARD & COUPON READY',
    accent: '#4F46E5',
    is_active: true,
  },
  {
    id: 'poster-referral-rewards',
    title: 'Refer Friends • Earn Ride Points & Discounts',
    subtitle: 'Invite friends & unlock referral ride credits on first completed trip',
    badge: 'REFER & EARN',
    code: null,
    tag: 'POINTS + RIDE REWARDS',
    accent: '#10B981',
    is_active: true,
  },
];

// 1. Validate & Apply Coupon Preview
router.post('/apply', verifyToken, async (req, res) => {
  try {
    const { code, booking_amount } = req.body;
    const numericAmount = parseFloat(booking_amount);

    if (!code || typeof code !== 'string' || !code.trim() || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Valid code aur positive booking_amount anivarya hain.',
      });
    }

    const { rows } = await db.query(
      `SELECT * FROM coupons
       WHERE UPPER(code) = UPPER($1)
         AND is_active = true`,
      [code.trim()]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Amanaya (Invalid) ya inactive coupon code.',
      });
    }

    const coupon = rows[0];
    const evaluation = evaluateCouponDiscount(coupon, numericAmount);

    if (!evaluation.isValid) {
      return res.status(422).json({
        success: false,
        error: evaluation.reason,
      });
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
    return res.status(500).json({
      success: false,
      error: 'Coupon validate karne mein server error aaya',
    });
  }
});

// 2. List All Active Public Coupons
router.get('/active', verifyToken, async (_req, res) => {
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
    return res.status(500).json({
      success: false,
      error: 'Coupons fetch karne mein error aaya',
    });
  }
});

// 3. Festive / Holiday Posters Feed (DB backed with safe fallback)
router.get('/festive-posters', verifyToken, async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, title, subtitle, badge, code, tag, accent, is_active
       FROM festive_posters
       WHERE is_active = true
         AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY created_at DESC`
    );

    return res.status(200).json({
      success: true,
      posters: rows.length > 0 ? rows : DEFAULT_FESTIVE_POSTERS,
    });
  } catch {
    return res.status(200).json({
      success: true,
      posters: DEFAULT_FESTIVE_POSTERS,
    });
  }
});

// 4. Redeem Gift Card Code
router.post('/redeem-gift-card', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const rawCode = String(req.body?.gift_code || '').trim().toUpperCase();

    if (!rawCode) {
      return res.status(400).json({
        success: false,
        error: 'Kripya gift card code darj karein.',
      });
    }

    const { rows } = await db.query(
      `SELECT id, code, reward_points, discount_amount, is_redeemed, expires_at
       FROM gift_cards
       WHERE UPPER(code) = $1
       LIMIT 1`,
      [rawCode]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Gift card code nahi mila ya invalid hai.',
      });
    }

    const card = rows[0];
    if (card.is_redeemed) {
      return res.status(400).json({
        success: false,
        error: 'Yeh gift card pehle hi redeem ho chuka hai.',
      });
    }

    if (card.expires_at && new Date(card.expires_at) < new Date()) {
      return res.status(400).json({
        success: false,
        error: 'Yeh gift card expire ho chuka hai.',
      });
    }

    await db.query(
      `UPDATE gift_cards
       SET is_redeemed = true, redeemed_by = $1, redeemed_at = NOW()
       WHERE id = $2`,
      [userId, card.id]
    );

    return res.status(200).json({
      success: true,
      message: 'Gift card safaltapoorvak redeem ho gaya hai!',
      reward_points: card.reward_points || 0,
      discount_amount: card.discount_amount || 0,
    });
  } catch (error) {
    console.error('Gift card redeem error:', error);
    return res.status(500).json({
      success: false,
      error: 'Gift card redeem karte waqt error aaya.',
    });
  }
});

// 5. Referral Summary & Apply Referral Code
router.get('/referral/summary', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const fallbackCode = `T3S-${String(userId).replace(/-/g, '').slice(0, 6).toUpperCase()}`;

    const { rows } = await db.query(
      `SELECT referral_code, referral_points, referred_count
       FROM users
       WHERE id = $1`,
      [userId]
    );

    const userRow = rows[0] || {};
    return res.status(200).json({
      success: true,
      referral_code: userRow.referral_code || fallbackCode,
      referral_points: Number(userRow.referral_points || 0),
      referred_count: Number(userRow.referred_count || 0),
    });
  } catch {
    const userId = req.user.id;
    const fallbackCode = `T3S-${String(userId).replace(/-/g, '').slice(0, 6).toUpperCase()}`;
    return res.status(200).json({
      success: true,
      referral_code: fallbackCode,
      referral_points: 0,
      referred_count: 0,
    });
  }
});

router.post('/referral/apply', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const code = String(req.body?.referral_code || '').trim().toUpperCase();

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Referral code anivarya hai.',
      });
    }

    const referrerRes = await db.query(
      `SELECT id FROM users WHERE UPPER(COALESCE(referral_code, '')) = $1 AND id <> $2 LIMIT 1`,
      [code, userId]
    );

    if (referrerRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Invalid referral code.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Referral code verified! Bonus points ride completion par credit honge.',
      bonus_points: 50,
    });
  } catch (error) {
    console.error('Referral apply error:', error);
    return res.status(500).json({
      success: false,
      error: 'Referral code apply karte waqt error aaya.',
    });
  }
});

module.exports = router;