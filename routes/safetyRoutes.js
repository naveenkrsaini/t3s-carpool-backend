// routes/safetyRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// Trigger Emergency SOS Alert
router.post('/sos-trigger', verifyToken, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { ride_id, latitude, longitude, address } = req.body;
    const userId = req.user.id;

    await client.query('BEGIN');

    // 1. Fetch user details
    const userQuery = await client.query(
      `SELECT name, phone FROM users WHERE id = $1`,
      [userId]
    );

    if (userQuery.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'User nahi mila' });
    }

    const user = userQuery.rows[0];

    // 2. Fetch all saved emergency contacts from the dedicated table
    const contactsQuery = await client.query(
      `SELECT contact_name, phone_number, relation FROM emergency_contacts WHERE user_id = $1`,
      [userId]
    );
    const emergencyContacts = contactsQuery.rows;

    const contactsSummary = emergencyContacts.length > 0 
      ? emergencyContacts.map(c => `${c.contact_name} (${c.phone_number})`).join(', ') 
      : 'No emergency contacts registered';

    // 3. Audit log mein high-priority SOS incident record karein
    const notes = `EMERGENCY SOS TRIGGERED by ${user.name} (${user.phone}). Location: Lat ${latitude || 'N/A'}, Long ${longitude || 'N/A'}, Address: ${address || 'N/A'}. Contacts: ${contactsSummary}`;

    await client.query(
      `INSERT INTO admin_audit_logs (
        admin_id, 
        action_type, 
        target_user_id, 
        target_ride_id, 
        notes
      ) VALUES ($1, 'SOS_DISTRESS_SIGNAL', $2, $3, $4)`,
      [userId, userId, ride_id || null, notes]
    );

    // 4. Agar ride_id di gayi hai, toh dispute/incident table mein bhi log karein
    if (ride_id) {
      await client.query(
        `INSERT INTO ride_disputes (
          ride_id, 
          reporter_id, 
          dispute_type, 
          description, 
          status
        ) VALUES ($1, $2, 'SAFETY_HAZARD', $3, 'open')`,
        [ride_id, userId, `SOS Trigger: ${notes}`]
      );
    }

    await client.query('COMMIT');

    return res.status(200).json({
      success: true,
      message: 'SOS distress alert safaltapoorvak log ho gaya hai.',
      emergency_contacts: emergencyContacts,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('SOS Trigger Error:', error);
    return res.status(500).json({ error: 'SOS alert process karne mein error aaya' });
  } finally {
    client.release();
  }
});

module.exports = router;