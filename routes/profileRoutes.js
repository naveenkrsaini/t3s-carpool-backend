// routes/profileRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');
const bcrypt = require('bcryptjs');

const getProfileHandler = async (req, res) => {
  try {
    const userId = req.user.id;

    const userQuery = `
      SELECT 
        u.id, u.name, u.first_name, u.last_name, u.username,
        u.email, u.phone, u.role, 
        COALESCE(
          (SELECT ROUND(AVG(rev.rating)::numeric, 1) FROM reviews rev WHERE rev.reviewed_user_id = u.id),
          5.0
        ) AS rating, 
        u.profile_image_url, u.verification_status, u.is_verified,
        u.user_category, u.is_category_verified, u.category_domain_email, u.created_at
      FROM users u 
      WHERE u.id = $1
    `;
    const userRes = await db.query(userQuery, [userId]);

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User nahi mila' });
    }

    const user = userRes.rows[0];

    let completedRides = 0;
    try {
      const riderStatsRes = await db.query(
        `SELECT COUNT(b.id) AS completed_rides FROM bookings b JOIN rides r ON b.ride_id = r.id WHERE b.rider_id = $1 AND b.booking_status = 'confirmed' AND r.status = 'completed'`,
        [userId]
      );
      completedRides = parseInt(riderStatsRes.rows[0]?.completed_rides || 0, 10);
    } catch (e) {
      console.warn('Rider stats warning:', e.message);
    }

    let ridesHosted = 0;
    try {
      const driverStatsRes = await db.query(
        `SELECT COUNT(id) AS rides_hosted FROM rides WHERE driver_id = $1 AND status = 'completed'`,
        [userId]
      );
      ridesHosted = parseInt(driverStatsRes.rows[0]?.rides_hosted || 0, 10);
    } catch (e) {
      console.warn('Driver stats warning:', e.message);
    }

    const totalKm = (completedRides + ridesHosted) * 25;
    const carbonSavedKg = (totalKm * 0.12).toFixed(1);

    return res.status(200).json({
      success: true,
      profile: user,
      user: user,
      stats: {
        total_completed_rides: completedRides,
        total_rides_hosted: ridesHosted,
        total_shared_km: Math.round(totalKm),
        carbon_saved_kg: parseFloat(carbonSavedKg),
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return res.status(500).json({ error: 'Profile fetch karne mein server error aaya' });
  }
};

router.get('/', verifyToken, getProfileHandler);
router.get('/me', verifyToken, getProfileHandler);

// --- 1. GET ALL USER DOCUMENTS & STATUS ---
router.get('/verification/my-status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Fetch user overall verification status
    const userRes = await db.query('SELECT verification_status FROM users WHERE id = $1', [userId]);
    const docsRes = await db.query('SELECT * FROM user_documents WHERE user_id = $1 ORDER BY created_at DESC', [userId]);

    return res.status(200).json({
      success: true,
      verification_status: userRes.rows[0]?.verification_status || 'unverified',
      documents: docsRes.rows,
    });
  } catch (error) {
    console.error('Verification status fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch verification status' });
  }
});

// --- 2. SUBMIT MULTIPLE DOCUMENTS ---
router.post('/verification/submit-document', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { document_type, document_number, document_front_url, document_back_url } = req.body;

    if (!document_type || !document_number || !document_front_url) {
      return res.status(400).json({ error: 'Document type, number aur front image anivarya hain.' });
    }

    const maskedNum = '****' + document_number.slice(-4);

    // Insert into separate user_documents table
    await db.query(
      `INSERT INTO user_documents (user_id, document_type, document_number_masked, document_front_url, document_back_url, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [userId, document_type, maskedNum, document_front_url, document_back_url || null]
    );

    // Update user status to pending review
    await db.query(
      `UPDATE users SET verification_status = 'pending', updated_at = NOW() WHERE id = $1`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      message: 'Document successfully submitted for review!',
    });
  } catch (error) {
    console.error('Document submission error:', error);
    return res.status(500).json({ error: 'Server error during document submission.' });
  }
});

// Switch User Active Role
router.patch('/switch-mode', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { mode } = req.body;

    if (!['rider', 'driver'].includes(mode)) {
      return res.status(400).json({ error: 'Mode keval rider ya driver ho sakta hai' });
    }

    if (mode === 'driver') {
      const check = await db.query(`SELECT is_verified, verification_status FROM users WHERE id = $1`, [userId]);
      if (!check.rows[0]?.is_verified) {
        return res.status(403).json({
          error: 'Driver Mode activate karne ke liye pehle apna Driving License verify karein.',
          verification_status: check.rows[0]?.verification_status || 'unverified',
        });
      }
    }

    await db.query(`UPDATE users SET role = $1 WHERE id = $2`, [mode, userId]);

    return res.status(200).json({
      success: true,
      message: `Aapka active mode safalta se switch hokar ${mode} ho gaya.`,
      active_role: mode,
    });
  } catch (error) {
    console.error('Mode switch error:', error);
    return res.status(500).json({ error: 'Mode switch karte waqt error aaya' });
  }
});

// --- CHANGE PASSWORD ---
router.post('/change-password', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current aur new password dono anivarya hain.' });
    }

    const userRes = await db.query('SELECT password_hash, password FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'User nahi mila.' });

    const user = userRes.rows[0];
    const storedHash = user.password_hash || user.password;
    let passwordMatches = storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') 
      ? await bcrypt.compare(currentPassword, storedHash) 
      : (currentPassword === storedHash);

    if (!passwordMatches) return res.status(400).json({ error: 'Aapka current password galat hai.' });

    const newHashedPassword = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHashedPassword, userId]);

    return res.status(200).json({ success: true, message: 'Password safalta se update ho gaya!' });
  } catch (error) {
    console.error('Change password error:', error);
    return res.status(500).json({ error: 'Password change karte waqt server error aaya.' });
  }
});

// --- UPDATE MPIN ---
router.post('/update-mpin', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { mpin } = req.body;
    if (!mpin || mpin.length !== 6) return res.status(400).json({ error: 'MPIN theek 6 digits ka hona chahiye.' });

    const hashedMpin = await bcrypt.hash(mpin.trim(), 10);
    await db.query('UPDATE users SET mpin_hash = $1, updated_at = NOW() WHERE id = $2', [hashedMpin, userId]);

    return res.status(200).json({ success: true, message: 'MPIN safalta se set ho gaya!' });
  } catch (error) {
    console.error('Update MPIN error:', error);
    return res.status(500).json({ error: 'MPIN update karte waqt server error aaya.' });
  }
});

// --- UPDATE BIOMETRIC SECURITY ---
router.post('/update-security', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { is_biometric_enabled } = req.body;
    if (typeof is_biometric_enabled !== 'boolean') return res.status(400).json({ error: 'Invalid preference.' });

    await db.query('UPDATE users SET is_biometric_enabled = $1, updated_at = NOW() WHERE id = $2', [is_biometric_enabled, userId]);
    return res.status(200).json({ success: true, message: 'Biometric setting update ho gayi!' });
  } catch (error) {
    console.error('Update security error:', error);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// --- VEHICLE & EMERGENCY & SAVED LOCATIONS ENDPOINTS ---
router.get('/vehicle/:userId', async (req, res) => {
  const result = await db.query('SELECT * FROM vehicles WHERE driver_id = $1', [req.params.userId]);
  res.json({ success: true, vehicle: result.rows[0] || null });
});

router.post('/vehicle', async (req, res) => {
  const { driver_id, vehicle_model, vehicle_number, color, capacity } = req.body;
  const result = await db.query(
    `INSERT INTO vehicles (driver_id, vehicle_model, vehicle_number, color, capacity) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (vehicle_number) DO UPDATE SET vehicle_model = $2, color = $4, capacity = $5 RETURNING *`,
    [driver_id, vehicle_model, vehicle_number, color, capacity || 3]
  );
  res.json({ success: true, vehicle: result.rows[0] });
});

router.get('/emergency-contacts/:userId', async (req, res) => {
  const result = await db.query('SELECT * FROM emergency_contacts WHERE user_id = $1', [req.params.userId]);
  res.json({ success: true, contacts: result.rows });
});

router.post('/emergency-contacts', async (req, res) => {
  const { user_id, contact_name, phone_number, relation } = req.body;
  const result = await db.query(
    `INSERT INTO emergency_contacts (user_id, contact_name, phone_number, relation) VALUES ($1, $2, $3, $4) RETURNING *`,
    [user_id, contact_name, phone_number, relation || 'Family']
  );
  res.json({ success: true, contact: result.rows[0] });
});

router.delete('/emergency-contacts/:contactId', async (req, res) => {
  await db.query('DELETE FROM emergency_contacts WHERE id = $1', [req.params.contactId]);
  res.json({ success: true });
});

router.get('/saved-locations/:userId', async (req, res) => {
  const result = await db.query('SELECT * FROM saved_locations WHERE user_id = $1', [req.params.userId]);
  res.json({ success: true, locations: result.rows });
});

router.post('/saved-locations', async (req, res) => {
  const { user_id, title, address, latitude, longitude } = req.body;
  const result = await db.query(
    `INSERT INTO saved_locations (user_id, title, address, latitude, longitude) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [user_id, title, address, latitude, longitude]
  );
  res.json({ success: true, location: result.rows[0] });
});

router.delete('/saved-locations/:locationId', async (req, res) => {
  await db.query('DELETE FROM saved_locations WHERE id = $1', [req.params.locationId]);
  res.json({ success: true });
});


// --- UPDATE LANGUAGE PREFERENCE ---
router.post('/update-language', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { preferred_language } = req.body;

    if (!['en', 'hi', 'hinglish'].includes(preferred_language)) {
      return res.status(400).json({ error: 'Invalid language selection.' });
    }

    await db.query(
      'UPDATE users SET preferred_language = $1, updated_at = NOW() WHERE id = $2',
      [preferred_language, userId]
    );

    res.json({ success: true, message: 'Language preference updated successfully!' });
  } catch (err) {
    console.error('Language update error:', err);
    res.status(500).json({ error: 'Server error updating language' });
  }
});

module.exports = router;