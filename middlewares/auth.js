// middlewares/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/db');

// 1. JWT Token aur Ban Status Verify karne ke liye
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'] || req.headers['Authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication token missing ya galat format mein hai' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_2026'
    );

    // Database se user verify karein (UUIDv7 support ke sath)
    const { rows } = await db.query(
      `SELECT id, name, email, role, is_banned, is_verified, verification_status 
       FROM users 
       WHERE id = $1`,
      [decoded.userId]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User session expire ho gaya ya user exist nahi karta' });
    }

    const user = rows[0];
    if (user.is_banned) {
      return res.status(403).json({ error: 'Aapka account suspend hai. Support team se contact karein.' });
    }

    // req.user set karein taaki aage ke routes iska use kar sakein
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid ya expired token' });
  }
};

// 2. Admin Privileges Check
const requireAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Access denied: Keval Admin hi is route ko access kar sakte hain' });
  }
  next();
};

// 3. Driver Account Check (Trial Ride Supported)
const requireDriver = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized access' });
    }

    // Agar admin ya superadmin hai toh allow karein
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return next();
    }

    // Agar user already driver role par hai ya verified hai toh allow karein
    if (req.user.role === 'driver' || req.user.is_verified) {
      return next();
    }

    // 💡 TRIAL RIDE CHECK: Check karein ki user ki database mein kitni rides bani hain
    const rideCountRes = await db.query(
      'SELECT COUNT(*) FROM rides WHERE driver_id = $1',
      [req.user.id]
    );
    const totalRides = parseInt(rideCountRes.rows[0].count, 10);

    // Agar ek bhi ride nahi bani hai (matlab pehli trial ride hai), toh access de do!
    if (totalRides === 0) {
      return next();
    }

    return res.status(403).json({ error: 'Access denied: Driver verification zaroori hai' });
  } catch (err) {
    console.error('requireDriver middleware error:', err);
    return res.status(500).json({ error: 'Authentication middleware error.' });
  }
};

module.exports = {
  verifyToken,
  requireAdmin,
  requireDriver,
};