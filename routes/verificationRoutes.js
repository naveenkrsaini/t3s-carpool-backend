// routes/verificationRoutes.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const { verifyToken, requireAdmin } = require('../middlewares/auth');

// Safe Pool reference
const pool = db.pool || db;

// Temporary memory store for Email OTPs
const otpStore = new Map();

// 1. Upload Directory Ensure Karein
const uploadDir = path.join(__dirname, '../uploads/documents');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Multer Disk Storage Configuration (Front & Back support)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const prefix = file.fieldname === 'document_front' ? 'front' : 'back';
    const uniqueName = `doc_${prefix}_${req.user.id}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max per file
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Keval JPG, PNG aur PDF files upload ki ja sakti hain'));
    }
  },
});

// Helper: Mask sensitive document numbers
const maskDocumentNumber = (num) => {
  if (!num || num.trim().length < 4) return 'NOT_PROVIDED';
  const clean = num.trim();
  const lastFour = clean.slice(-4);
  return `XXXX-XXXX-${lastFour}`;
};

// ==========================================
// A. EMAIL & CORPORATE/STUDENT OTP ROUTES
// ==========================================
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

router.post('/send-otp', verifyToken, async (req, res) => {
  try {
    const { email, type } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address anivarya hai.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(email, { otp, type, expiresAt: Date.now() + 5 * 60 * 1000 });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: `Your ${type === 'corporate' ? 'Corporate' : 'Student'} Verification OTP`,
      text: `Aapka verification OTP hai: ${otp}. Yeh 5 minutes mein expire ho jayega.`,
    };

    await transporter.sendMail(mailOptions);

    return res.status(200).json({ 
      success: true, 
      message: `OTP successfully send ho gaya hai ${email} par.` 
    });
  } catch (error) {
    console.error('Email send error:', error);
    return res.status(500).json({ success: false, message: 'Email bhejne mein samasya aayi.' });
  }
});

router.post('/verify-otp', verifyToken, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { email, otp, type } = req.body;
    
    const record = otpStore.get(email);
    if (!record) {
      return res.status(400).json({ success: false, message: 'Pehle OTP request karein.' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(email);
      return res.status(400).json({ success: false, message: 'OTP expire ho chuka hai. Dobara try karein.' });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ success: false, message: 'Galat OTP enter kiya gaya hai.' });
    }

    otpStore.delete(email);

    await client.query('BEGIN');

    const updateQuery = `
      UPDATE users 
      SET user_category = $1,
          category_domain_email = $2,
          is_category_verified = TRUE,
          updated_at = NOW()
      WHERE id = $3
      RETURNING id, name, email, user_category, category_domain_email, is_category_verified;
    `;

    const { rows } = await client.query(updateQuery, [
      type === 'corporate' ? 'Corporate' : 'Student',
      email.trim().toLowerCase(),
      userId,
    ]);

    await client.query(
      `INSERT INTO admin_audit_logs (action_type, target_user_id, notes) 
       VALUES ('EMAIL_BADGE_VERIFIED', $1, $2)`,
      [userId, `User ne ${type} email (${email}) verify kiya`]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Verification successful! Badge unlock ho gaya hai.',
      user: rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Verify OTP error:', error);
    return res.status(500).json({ success: false, message: 'OTP verification ke dauran server error aaya.' });
  } finally {
    client.release();
  }
});


// ==========================================
// B. GOVT ID / DRIVING LICENSE UPLOAD ROUTES (FRONT & BACK)
// ==========================================

router.post('/submit-document', verifyToken, upload.fields([
  { name: 'document_front', maxCount: 1 },
  { name: 'document_back', maxCount: 1 }
]), async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { document_type, document_number, user_category, category_domain_email } = req.body;
    
    const frontFile = req.files?.document_front ? req.files.document_front[0] : null;
    const backFile = req.files?.document_back ? req.files.document_back[0] : null;

    if (!frontFile || !backFile) {
      return res.status(400).json({ error: 'Kripya document ki front aur back dono photos upload karein' });
    }

    if (!document_type) {
      return res.status(400).json({ error: 'document_type anivarya hai' });
    }

    const maskedNumber = maskDocumentNumber(document_number);
    const frontUrl = `/uploads/documents/${frontFile.filename}`;
    const backUrl = `/uploads/documents/${backFile.filename}`;
    const cleanDocNumber = document_number ? document_number.trim().toUpperCase() : null;
    const isDL = document_type === 'driving_license';

    await client.query('BEGIN');

    const updateQuery = `
      UPDATE users 
      SET verification_status = 'pending',
          document_type = $1,
          document_url = $2,
          document_front_url = $3,
          document_back_url = $4,
          document_number_masked = $5,
          dl_number = COALESCE($6, dl_number),
          govt_id_number = COALESCE($7, govt_id_number),
          user_category = COALESCE($8, user_category, 'General'),
          category_domain_email = COALESCE($9, category_domain_email),
          verification_notes = NULL,
          updated_at = NOW()
      WHERE id = $10
      RETURNING id, name, email, role, verification_status, document_type, document_number_masked, user_category;
    `;

    const { rows } = await client.query(updateQuery, [
      document_type,
      frontUrl, // backward compatibility ke liye primary url front set kar diya
      frontUrl,
      backUrl,
      maskedNumber,
      isDL ? cleanDocNumber : null,
      !isDL ? cleanDocNumber : null,
      user_category || null,
      category_domain_email ? category_domain_email.trim().toLowerCase() : null,
      userId,
    ]);

    await client.query(
      `INSERT INTO admin_audit_logs (action_type, target_user_id, notes) 
       VALUES ('DOC_SUBMITTED', $1, $2)`,
      [userId, `User ne ${document_type} (Front & Back) verification ke liye submit kiya`]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'Aapke documents safaltapoorvak upload ho gaye hain. Review pending hai.',
      user: rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Doc upload error:', error);
    return res.status(500).json({ error: 'Document submit karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

router.post('/submit-verification', verifyToken, (req, res, next) => {
  req.url = '/submit-document';
  router.handle(req, res, next);
});

router.get('/my-status', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { rows } = await pool.query(
      `SELECT id, name, email, role, verification_status, is_verified, 
              document_type, document_number_masked, document_url, 
              document_front_url, document_back_url,
              user_category, is_category_verified, verification_notes, verified_at 
       FROM users 
       WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User nahi mila' });
    }

    return res.status(200).json({ success: true, verification: rows[0] });
  } catch (error) {
    console.error('Status fetch error:', error);
    return res.status(500).json({ error: 'Status fetch karne mein error aaya' });
  }
});

router.get('/verification-status', verifyToken, (req, res, next) => {
  req.url = '/my-status';
  router.handle(req, res, next);
});

router.get('/admin/pending-verifications', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, email, phone, role, document_type, document_number_masked, 
              document_url, document_front_url, document_back_url, verification_status, user_category, created_at 
       FROM users 
       WHERE verification_status = 'pending' 
       ORDER BY created_at ASC`
    );

    return res.status(200).json({ success: true, count: rows.length, pending_requests: rows });
  } catch (error) {
    console.error('Admin pending verifications error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.patch('/admin/review/:userId', verifyToken, requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const adminId = req.user.id;
    const targetUserId = req.params.userId;
    const { status, notes } = req.body;

    if (!['verified', 'rejected', 'unverified'].includes(status)) {
      return res.status(400).json({ error: 'Status keval verified, rejected ya unverified ho sakta hai' });
    }

    await client.query('BEGIN');

    const isVerified = status === 'verified';
    const verifiedAt = isVerified ? new Date() : null;

    const updateQuery = `
      UPDATE users 
      SET verification_status = $1,
          is_verified = $2,
          role = CASE 
            WHEN $2 = TRUE AND document_type = 'driving_license' THEN 'driver' 
            ELSE role 
          END,
          verification_notes = $3,
          verified_at = $4,
          updated_at = NOW()
      WHERE id = $5
      RETURNING id, name, email, role, verification_status, is_verified;
    `;

    const { rows } = await client.query(updateQuery, [
      status,
      isVerified,
      notes || (isVerified ? 'Document verified successfully' : 'Document rejected'),
      verifiedAt,
      targetUserId,
    ]);

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Target user nahi mila' });
    }

    await client.query(
      `INSERT INTO admin_audit_logs (action_type, target_user_id, admin_id, notes) 
       VALUES ($1, $2, $3, $4)`,
      [
        isVerified ? 'DOC_APPROVED' : 'DOC_REJECTED',
        targetUserId,
        adminId,
        notes || (isVerified ? 'Document verified' : 'Document rejected'),
      ]
    );

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: `User status update hokar ${status} ho gaya hai`,
      user: rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Admin review error:', error);
    return res.status(500).json({ error: 'Review submit karte waqt server error aaya' });
  } finally {
    client.release();
  }
});

module.exports = router;