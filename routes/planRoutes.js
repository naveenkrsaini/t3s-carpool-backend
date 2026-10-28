// routes/planRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// 1. Fetch All Active Commute Plans
router.get('/available', verifyToken, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, description, total_rides, price, validity_days 
       FROM ride_plans 
       WHERE is_active = true 
       ORDER BY price ASC`
    );

    return res.status(200).json({ success: true, plans: rows });
  } catch (error) {
    console.error('Fetch plans error:', error);
    return res.status(500).json({ error: 'Plans fetch karne mein dikkat aayi' });
  }
});

// 2. Subscribe / Purchase Commute Pass
router.post('/subscribe', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { plan_id } = req.body;
    const userId = req.user.id;

    if (!plan_id) {
      return res.status(400).json({ error: 'plan_id anivarya hai' });
    }

    await client.query('BEGIN');

    // Plan verify karein
    const planResult = await client.query(
      `SELECT * FROM ride_plans WHERE id = $1 AND is_active = true`,
      [plan_id]
    );

    if (planResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Plan nahi mila ya inactive hai' });
    }

    const plan = planResult.rows[0];

    // Check karein user ka pehle se active subscription hai ya nahi
    const activeSubResult = await client.query(
      `SELECT id FROM user_subscriptions 
       WHERE user_id = $1 
       AND status = 'active' 
       AND expires_at > NOW() 
       AND rides_remaining > 0`,
      [userId]
    );

    if (activeSubResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Aapka ek commute pass pehle se active hai. Expiry ke baad naya pass lein.',
      });
    }

    // Validity calculate karein
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(plan.validity_days));

    // Subscription entry insert karein
    const insertSub = await client.query(
      `INSERT INTO user_subscriptions (
        user_id, 
        plan_id, 
        rides_remaining, 
        status, 
        expires_at
      ) VALUES ($1, $2, $3, 'active', $4)
      RETURNING *`,
      [userId, plan.id, plan.total_rides, expiresAt.toISOString()]
    );

    // Audit log
    await client.query(
      `INSERT INTO admin_audit_logs (
        action_type, target_user_id, notes
      ) VALUES ('COMMUTE_PASS_PURCHASED', $1, $2)`,
      [userId, `Purchased plan ${plan.name} for ₹${plan.price}. Total rides: ${plan.total_rides}`]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `${plan.name} pass safaltapoorvak activate ho gaya hai!`,
      subscription: insertSub.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Subscription error:', error);
    return res.status(500).json({ error: 'Plan purchase karte waqt error aaya' });
  } finally {
    client.release();
  }
});

// 3. Get User Active Subscription Details
router.get('/my-subscription', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const { rows } = await db.query(
      `SELECT s.id, s.rides_remaining, s.status, s.expires_at, 
              p.name AS plan_name, p.total_rides, p.validity_days
       FROM user_subscriptions s
       JOIN ride_plans p ON s.plan_id = p.id
       WHERE s.user_id = $1 
       AND s.status = 'active'
       AND s.expires_at > NOW()
       AND s.rides_remaining > 0
       ORDER BY s.created_at DESC 
       LIMIT 1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(200).json({ has_active_subscription: false, subscription: null });
    }

    return res.status(200).json({
      has_active_subscription: true,
      subscription: rows[0],
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    return res.status(500).json({ error: 'Subscription data fetch karne mein error aaya' });
  }
});

module.exports = router;