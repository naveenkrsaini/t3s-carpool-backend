// routes/sessionRoutes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'super_jwt_secret_dev_123';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'super_refresh_secret_dev_456';

// Helper: 15-minute access token generate karna
const generateAccessToken = (user) => {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '15m' }
  );
};

// 1. Silent Token Refresh Endpoint
router.post('/refresh-token', async (req, res) => {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      return res.status(400).json({ error: 'Refresh token anivarya hai' });
    }

    // Verify cryptographic signature
    let decoded;
    try {
      decoded = jwt.verify(refresh_token, REFRESH_SECRET);
    } catch (jwtErr) {
      return res.status(401).json({ error: 'Refresh token invalid ya expire ho chuka hai' });
    }

    // Check if session exists in DB and is active
    const sessionRes = await db.query(
      `SELECT s.*, u.email, u.role, u.name 
       FROM user_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.refresh_token = $1 AND s.is_revoked = false AND s.expires_at > NOW()`,
      [refresh_token]
    );

    if (sessionRes.rows.length === 0) {
      return res.status(401).json({ error: 'Session invalidate ya revoke ho chuki hai. Kripya login karein.' });
    }

    const session = sessionRes.rows[0];

    // Naya short-lived access token issue karein
    const newAccessToken = generateAccessToken({
      id: session.user_id,
      email: session.email,
      role: session.role,
    });

    return res.status(200).json({
      success: true,
      access_token: newAccessToken,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(500).json({ error: 'Token refresh fail ho gaya' });
  }
});

// 2. Current Device Logout
router.post('/logout', verifyToken, async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      await db.query(
        `UPDATE user_sessions SET is_revoked = true, updated_at = NOW() WHERE refresh_token = $1`,
        [refresh_token]
      );
    }
    return res.status(200).json({ success: true, message: 'Current session successfully logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({ error: 'Logout fail ho gaya' });
  }
});

// 3. Multi-Device Logout ("Log out from all devices")
router.post('/logout-all', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await db.query(
      `UPDATE user_sessions 
       SET is_revoked = true, updated_at = NOW() 
       WHERE user_id = $1 AND is_revoked = false`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Sabhi devices se aapka session revoke kar diya gaya hai.',
    });
  } catch (error) {
    console.error('Logout all error:', error);
    return res.status(500).json({ error: 'Session revoke karne me error aaya' });
  }
});

module.exports = router;