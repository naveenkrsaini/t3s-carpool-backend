// routes/reviewRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// 1. Submit Post-Ride Review (Driver -> Passenger ya Passenger -> Driver)
router.post('/submit', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const reviewerId = req.user.id;
    const { ride_id, reviewee_id, rating, comment, tags } = req.body;

    // Basic Validation
    if (!ride_id || !reviewee_id || !rating) {
      return res.status(400).json({ error: 'ride_id, reviewee_id aur rating anivarya hain' });
    }

    const numericRating = parseInt(rating, 10);
    if (numericRating < 1 || numericRating > 5) {
      return res.status(400).json({ error: 'Rating 1 se 5 ke beech honi chahiye' });
    }

    if (reviewerId === reviewee_id) {
      return res.status(400).json({ error: 'Aap swayam ko review nahi de sakte' });
    }

    await client.query('BEGIN');

    // Step A: Check karein kya ride complete ho chuki hai
    const rideCheck = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1`,
      [ride_id]
    );

    if (rideCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Ride nahi mili' });
    }

    const ride = rideCheck.rows[0];
    if (ride.status !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Keval completed rides par hi review diya ja sakta hai' });
    }

    // Step B: Duplicate review check (Ek ride par ek hi baar review diya ja sakta hai)
    const duplicateCheck = await client.query(
      `SELECT id FROM reviews 
       WHERE ride_id = $1 AND reviewer_id = $2 AND reviewee_id = $3`,
      [ride_id, reviewerId, reviewee_id]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Aap pehle hi is ride ke liye review darj kar chuke hain' });
    }

    // Step C: Reviews table mein entry insert karein
    const insertReviewQuery = `
      INSERT INTO reviews (
        ride_id,
        reviewer_id,
        reviewee_id,
        rating,
        comment,
        tags
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;

    const reviewResult = await client.query(insertReviewQuery, [
      ride_id,
      reviewerId,
      reviewee_id,
      numericRating,
      comment ? comment.trim() : null,
      tags && Array.isArray(tags) ? tags : [],
    ]);

    // Step D: Reviewee ki nayi aggregate average rating recalculate karein
    const aggregateQuery = `
      SELECT 
        COUNT(id) AS review_count,
        ROUND(AVG(rating)::numeric, 2) AS average_rating
      FROM reviews
      WHERE reviewee_id = $1;
    `;
    const aggResult = await client.query(aggregateQuery, [reviewee_id]);
    const { review_count, average_rating } = aggResult.rows[0];

    // Step E: Users table mein user ki profile update karein
    await client.query(
      `UPDATE users 
       SET rating = $1,
           total_reviews = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [average_rating, review_count, reviewee_id]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Review safaltapoorvak submit ho gaya hai.',
      review: reviewResult.rows[0],
      new_rating: average_rating,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Review submission error:', error);
    return res.status(500).json({ error: 'Review darj karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

// 2. Fetch User Profile Reviews & Behavioral Tags
router.get('/user/:userId', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;

    const { rows } = await db.query(
      `SELECT 
        r.id,
        r.rating,
        r.comment,
        r.tags,
        r.created_at,
        u.name AS reviewer_name
       FROM reviews r
       JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewee_id = $1
       ORDER BY r.created_at DESC
       LIMIT 20`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      reviews: rows,
    });
  } catch (error) {
    console.error('Fetch user reviews error:', error);
    return res.status(500).json({ error: 'User reviews fetch karne mein error aaya' });
  }
});

module.exports = router;