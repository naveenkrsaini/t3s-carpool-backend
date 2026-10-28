// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { generateUniqueUsername } = require('../utils/usernameGenerator');

// --- 1. SIGN UP ROUTE (Email & Password based) ---
router.post('/signup', async (req, res) => {
  try {
    const { 
      first_name, 
      last_name, 
      name, 
      username, 
      email, 
      password, 
      phone, 
      role = 'rider', 
      photo_url 
    } = req.body;

    let fName = (first_name || '').trim();
    let lName = (last_name || '').trim();

    if (!fName && name) {
      const parts = name.trim().split(' ');
      fName = parts[0] || '';
      lName = parts.slice(1).join(' ') || '';
    }

    if (!fName || !email || !password) {
      return res.status(400).json({ error: 'First name, email aur password anivarya hain!' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existingUser = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Is email se pehle hi account bana hua hai.' });
    }

    const fullName = `${fName} ${lName}`.trim();
    let finalUsername = '';

    if (username && username.trim()) {
      const cleanUsername = username.trim().toLowerCase();
      const existingUsername = await db.query(
        'SELECT id FROM users WHERE LOWER(username) = $1',
        [cleanUsername]
      );
      if (existingUsername.rows.length > 0) {
        return res.status(409).json({
          error: 'Yeh username pehle se liya ja chuka hai. Kripya doosra chunein.',
        });
      }
      finalUsername = cleanUsername;
    } else {
      finalUsername = await generateUniqueUsername(fName);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertQuery = `
      INSERT INTO users (
        name, 
        first_name, 
        last_name, 
        username, 
        email, 
        password_hash, 
        phone, 
        role, 
        is_verified, 
        profile_image_url
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9) 
      RETURNING id, name, first_name, last_name, username, email, phone, role, is_verified, profile_image_url, created_at;
    `;

    const newUser = await db.query(insertQuery, [
      fullName,
      fName,
      lName || null,
      finalUsername,
      cleanEmail,
      hashedPassword,
      phone || null,
      role,
      photo_url || null,
    ]);

    const createdUser = newUser.rows[0];

    const token = jwt.sign(
      { userId: createdUser.id, role: createdUser.role },
      process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_2026',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Account safalta se ban gaya!',
      token,
      user: createdUser,
    });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ error: 'Server Error during signup' });
  }
});

// --- 2. USER LOGIN (Email & Password) ---
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide Email and Password' });
    }

    const userRes = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)', 
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(400).json({ error: 'User nahi mila!' });
    }

    const user = userRes.rows[0];
    const storedHash = user.password_hash || user.password;

    if (!storedHash) {
      return res.status(400).json({ error: 'Invalid user credentials' });
    }

    let passwordMatches = false;
    if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$')) {
      passwordMatches = await bcrypt.compare(password, storedHash);
    } else {
      passwordMatches = (password === storedHash);
    }

    if (!passwordMatches) {
      return res.status(400).json({ error: 'Galat password entered!' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_2026',
      { expiresIn: '7d' }
    );

    delete user.password_hash;
    delete user.password;

    return res.json({
      success: true,
      message: 'Logged in successfully!',
      token,
      user,
    });
  } catch (err) {
    console.error('Login error:', err.message);
    return res.status(500).json({ error: 'Server Error during login' });
  }
});

// --- 2.1 PHONE OTP: SEND OTP ---
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone || phone.trim().length < 10) {
      return res.status(400).json({ error: 'Kripya valid 10-digit mobile number enter karein.' });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins expiry

    // 🔹 Check if user already exists to record user_id
    const userCheck = await db.query('SELECT id FROM users WHERE phone = $1', [phone.trim()]);
    const userId = userCheck.rows.length > 0 ? userCheck.rows[0].id : null;

    // 🔹 Insert or Update OTP with user_id linkage
    await db.query(
      `INSERT INTO phone_otps (user_id, phone, otp, expires_at) 
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (phone) 
       DO UPDATE SET user_id = $1, otp = $3, expires_at = $4, created_at = NOW()`,
      [userId, phone.trim(), otp, expiresAt]
    );

    console.log(`📱 [OTP] Phone: ${phone.trim()} | Code: ${otp} | UserID: ${userId || 'New User'}`);

    return res.status(200).json({
      success: true,
      message: 'OTP safaltapoorvak bhej diya gaya hai',
      dev_otp: otp, // Testing ke liye
    });
  } catch (error) {
    console.error('Send OTP error:', error);
    return res.status(500).json({ error: 'OTP bhejne mein server error aaya' });
  }
});

// --- 2.2 PHONE OTP: VERIFY OTP & QUICK LOGIN / SIGNUP ---
router.post('/verify-otp', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone aur OTP dono anivarya hain.' });
    }

    await client.query('BEGIN');

    const otpRes = await client.query(
      `SELECT * FROM phone_otps WHERE phone = $1 AND expires_at > NOW()`,
      [phone.trim()]
    );

    if (otpRes.rows.length === 0 || otpRes.rows[0].otp !== otp.toString().trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Amanaya (Invalid) ya expired OTP hai.' });
    }

    let userRes = await client.query(`SELECT * FROM users WHERE phone = $1`, [phone.trim()]);
    let user;

    if (userRes.rows.length === 0) {
      // Auto register phone user with generated username
      const defaultName = `User_${phone.trim().slice(-4)}`;
      const generatedUsername = await generateUniqueUsername('User');
      const newUserRes = await client.query(
        `INSERT INTO users (name, first_name, username, phone, role, is_verified) 
         VALUES ($1, $1, $2, $3, 'rider', false) RETURNING *`,
        [defaultName, generatedUsername, phone.trim()]
      );
      user = newUserRes.rows[0];
    } else {
      user = userRes.rows[0];
    }

    await client.query(`DELETE FROM phone_otps WHERE phone = $1`, [phone.trim()]);
    await client.query('COMMIT');

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_2026',
      { expiresIn: '7d' }
    );

    delete user.password_hash;
    delete user.password;
    delete user.mpin_hash;

    const isMpinSet = !!user.mpin_hash;

    return res.status(200).json({
      success: true,
      message: 'Phone login safal raha!',
      token,
      user,
      is_mpin_set: isMpinSet,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Verify OTP error:', error);
    return res.status(500).json({ error: 'OTP verify karte waqt error aaya' });
  } finally {
    client.release();
  }
});

// --- 3. CHECK USERNAME AVAILABILITY ---
router.get('/check-username/:username', async (req, res) => {
  try {
    const requestedUsername = req.params.username.trim().toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(requestedUsername)) {
      return res.status(400).json({
        available: false,
        error: 'Username 3 se 25 characters ka hona chahiye aur keval a-z, 0-9, _ allowed hain.',
      });
    }

    const check = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [requestedUsername]);
    return res.status(200).json({ available: check.rows.length === 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Username check karte waqt error aaya' });
  }
});

// --- 4. GET USER PROFILE ---
router.get('/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await db.query(
      `SELECT id, name, first_name, last_name, username, email, phone, role, profile_image_url, is_verified, created_at 
       FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user.rows[0]);
  } catch (err) {
    console.error('Fetch profile error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// --- 5. GET USER'S AVERAGE RATING ---
router.get('/user/:id/rating', async (req, res) => {
  const userId = req.params.id;
  try {
    const result = await db.query(
      `SELECT 
         COALESCE(ROUND(AVG(rating)::numeric, 1), 5.0) AS average_rating, 
         COUNT(id) AS total_reviews 
       FROM reviews 
       WHERE reviewed_user_id = $1`,
      [userId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Database Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch user rating' });
  }
});

// --- 6. UPLOAD / REQUEST DRIVER VERIFICATION ---
router.post('/verify-driver', async (req, res) => {
  try {
    const { user_id, document_url } = req.body;
    const result = await db.query(
      `UPDATE users 
       SET verification_status = 'pending', profile_image_url = COALESCE($1, profile_image_url)
       WHERE id = $2 
       RETURNING id, name, email, role, verification_status`,
      [document_url, user_id]
    );
    res.json({ message: 'ID submitted for review!', user: result.rows[0] });
  } catch (err) {
    console.error('Verify driver error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// --- 7. SAVE PUSH TOKEN ---
router.post('/save-push-token', async (req, res) => {
  try {
    const { user_id, push_token } = req.body;
    await db.query('UPDATE users SET push_token = $1 WHERE id = $2', [push_token, user_id]);
    res.json({ message: 'Push token saved!' });
  } catch (err) {
    console.error('Save push token error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// --- 8. UPDATE USER PROFILE ---
router.put('/profile/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { name, first_name, last_name, phone } = req.body;

    const updatedUser = await db.query(
      `UPDATE users 
       SET name = COALESCE($1, name), 
           first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           phone = COALESCE($4, phone) 
       WHERE id = $5 
       RETURNING id, name, first_name, last_name, username, email, phone, role, verification_status`,
      [name, first_name, last_name, phone, userId]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'Profile updated successfully!', user: updatedUser.rows[0] });
  } catch (err) {
    console.error('Database Error:', err.message);
    res.status(500).json({ error: 'Server Error' });
  }
});

// --- 9. FORGOT PASSWORD ---
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email is required.' });
  }

  try {
    const userCheck = await db.query(
      'SELECT id, email FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'This email is not registered with us.' });
    }

    const userId = userCheck.rows[0].id;
    const resetOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000);

    await db.query(
      'UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE id = $3',
      [resetOtp, expiry, userId]
    );

    console.log(`\n🔑 PASSWORD RESET OTP for ${email.trim()}: ${resetOtp}\n`);

    res.json({
      success: true,
      message: 'A 6-digit OTP has been generated. Check backend logs or email.',
    });
  } catch (err) {
    console.error('Forgot password error:', err.message);
    res.status(500).json({ error: 'Server error during password recovery.' });
  }
});

// --- 10. RESET PASSWORD ---
router.post('/reset-password', async (req, res) => {
  const { email, otp, new_password } = req.body;

  if (!email || !otp || !new_password) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required.' });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const userRes = await db.query(
      'SELECT id, reset_token, reset_token_expiry FROM users WHERE LOWER(email) = LOWER($1)',
      [email.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid user request.' });
    }

    const user = userRes.rows[0];

    if (!user.reset_token || user.reset_token !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid OTP entered.' });
    }

    if (new Date() > new Date(user.reset_token_expiry)) {
      return res.status(400).json({ error: 'OTP has expired. Please request a new one.' });
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);

    await db.query(
      'UPDATE users SET password_hash = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.json({
      success: true,
      message: 'Password reset successful! You can now log in.',
    });
  } catch (err) {
    console.error('Reset password error:', err.message);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

// --- 11. MPIN LOGIN ROUTE ---
router.post('/mpin-login', async (req, res) => {
  try {
    const { userId, mpin } = req.body;
    if (!userId || !mpin) {
      return res.status(400).json({ error: 'User ID and MPIN are required.' });
    }

    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userRes.rows[0];

    if (!user.mpin_hash) {
      return res.status(401).json({ error: 'MPIN not set up for this user.' });
    }

    const isMpinValid = await bcrypt.compare(mpin.trim(), user.mpin_hash);
    if (!isMpinValid) {
      return res.status(401).json({ error: 'Invalid MPIN entered.' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_2026',
      { expiresIn: '7d' }
    );

    delete user.password_hash;
    delete user.password;
    delete user.mpin_hash;

    return res.json({
      success: true,
      message: 'MPIN verified successfully!',
      token,
      user,
    });
  } catch (err) {
    console.error('MPIN login error:', err.message);
    return res.status(500).json({ error: 'Server Error during MPIN login' });
  }
});

// --- 12. BIOMETRIC LOGIN ROUTE ---
router.post('/biometric-login', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    const userRes = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userRes.rows[0];

    if (user.is_biometric_enabled === false) {
      return res.status(403).json({ error: 'Biometric login is disabled by user in settings.' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET || 'super_secure_jwt_secret_key_change_in_production_2026',
      { expiresIn: '7d' }
    );

    delete user.password_hash;
    delete user.password;
    delete user.mpin_hash;

    return res.json({
      success: true,
      message: 'Biometric session initialized successfully!',
      token,
      user,
    });
  } catch (err) {
    console.error('Biometric login error:', err.message);
    return res.status(500).json({ error: 'Server Error during biometric login' });
  }
});

// --- 13. UPDATE BIOMETRIC & MPIN PREFERENCES (Profile Security) ---
router.post('/profile/update-security', async (req, res) => {
  try {
    const { user_id, mpin, is_biometric_enabled } = req.body;
    if (!user_id) {
      return res.status(400).json({ error: 'User ID is required.' });
    }

    let updateQuery = 'UPDATE users SET updated_at = NOW()';
    let queryParams = [];
    let paramIndex = 1;

    if (mpin && mpin.length === 6) {
      const hashedMpin = await bcrypt.hash(mpin.trim(), 10);
      updateQuery += `, mpin_hash = $${paramIndex++}`;
      queryParams.push(hashedMpin);
    }

    if (typeof is_biometric_enabled === 'boolean') {
      updateQuery += `, is_biometric_enabled = $${paramIndex++}`;
      queryParams.push(is_biometric_enabled);
    }

    updateQuery += ` WHERE id = $${paramIndex} RETURNING id, is_biometric_enabled`;
    queryParams.push(user_id);

    const result = await db.query(updateQuery, queryParams);

    return res.json({
      success: true,
      message: 'Security settings updated successfully!',
      user: result.rows[0],
    });
  } catch (err) {
    console.error('Update security error:', err.message);
    return res.status(500).json({ error: 'Server Error while updating security settings' });
  }
});

module.exports = router;