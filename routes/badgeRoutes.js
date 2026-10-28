// routes/badgeRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// Blocked public domains (In par corporate badge nahi milega)
const BLOCKED_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'icloud.com',
  'rediffmail.com',
];

// 1. Send OTP for Institutional Email Verification
router.post('/send-otp', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { email, badge_type } = req.body; // badge_type: 'student' | 'corporate'

    if (!email || !badge_type) {
      return res.status(400).json({ error: 'Email aur badge_type anivarya hain' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const domain = cleanEmail.split('@')[1];

    if (!domain) {
      return res.status(400).json({ error: 'Amanaya (Invalid) email address' });
    }

    // Validation checks
    if (badge_type === 'student') {
      const isEdu = domain.endsWith('.edu') || domain.endsWith('.ac.in') || domain.includes('.edu.');
      if (!isEdu) {
        return res.status(400).json({
          error: 'Student badge ke liye मान्य (.edu ya .ac.in) college email anivarya hai.',
        });
      }
    } else if (badge_type === 'corporate') {
      if (BLOCKED_DOMAINS.includes(domain)) {
        return res.status(400).json({
          error: 'Corporate badge ke liye official work email anivarya hai (Gmail/Yahoo allowed nahi hai).',
        });
      }
    } else {
      return res.status(400).json({ error: 'Amanaya badge type' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes valid

    await db.query(
      `UPDATE users 
       SET badge_otp = $1, 
           badge_otp_expires_at = $2 
       WHERE id = $3`,
      [otp, expiresAt, userId]
    );

    console.log(`[INSTITUTIONAL OTP] (${badge_type}) to ${cleanEmail}: ${otp}`);

    return res.status(200).json({
      success: true,
      message: `${cleanEmail} par 6-digit verification code bhej diya gaya hai.`,
    });
  } catch (error) {
    console.error('Badge OTP error:', error);
    return res.status(500).json({ error: 'OTP bhejne me dikkat aayi' });
  }
});

// 2. Verify OTP & Assign Badge
router.post('/verify-otp', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { email, badge_type, otp } = req.body;

    if (!email || !badge_type || !otp) {
      return res.status(400).json({ error: 'Email, badge_type aur OTP anivarya hain' });
    }

    const { rows } = await db.query(
      `SELECT badge_otp, badge_otp_expires_at FROM users WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User nahi mila' });
    }

    const user = rows[0];

    if (!user.badge_otp || user.badge_otp !== otp.trim()) {
      return res.status(400).json({ error: 'Galat (Invalid) OTP enter kiya gaya hai' });
    }

    if (new Date() > new Date(user.badge_otp_expires_at)) {
      return res.status(400).json({ error: 'OTP expire ho chuka hai. Kripya naya OTP generate karein.' });
    }

    // Badge flags update karein
    if (badge_type === 'student') {
      await db.query(
        `UPDATE users 
         SET is_category_verified = TRUE,
             student_email = $1,
             badge_otp = NULL,
             badge_otp_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [email.trim().toLowerCase(), userId]
      );
    } else {
      await db.query(
        `UPDATE users 
         SET is_category_verified = TRUE,
             corporate_email = $1,
             badge_otp = NULL,
             badge_otp_expires_at = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [email.trim().toLowerCase(), userId]
      );
    }

    return res.status(200).json({
      success: true,
      message: `Badhai ho! Aapka ${badge_type === 'student' ? 'Student' : 'Corporate'} badge safalta se verify ho gaya.`,
      badge_type,
    });
  } catch (error) {
    console.error('Badge verify error:', error);
    return res.status(500).json({ error: 'Badge verify karte waqt server error aaya' });
  }
});

module.exports = router;