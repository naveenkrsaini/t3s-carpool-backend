// routes/adminRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, requireAdmin } = require('../middlewares/auth');

// 1. Admin Dashboard Metrics (Overview Stats)
router.get('/metrics', verifyToken, requireAdmin, async (req, res) => {
  try {
    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM users WHERE role = 'driver' AND is_verified = true) AS verified_drivers,
        (SELECT COUNT(*) FROM users WHERE verification_status = 'pending') AS pending_verifications,
        (SELECT COUNT(*) FROM rides WHERE status = 'scheduled') AS active_scheduled_rides,
        (SELECT COUNT(*) FROM rides WHERE status = 'in_progress') AS ongoing_rides,
        (SELECT COUNT(*) FROM safety_incidents WHERE status = 'open') AS active_sos_alerts;
    `;
    const { rows } = await db.query(statsQuery);
    return res.status(200).json({ success: true, metrics: rows[0] });
  } catch (error) {
    console.error('Admin metrics error:', error);
    return res.status(500).json({ error: 'Failed to fetch admin metrics' });
  }
});

// 2. Live SOS & Emergency Incidents Feed
router.get('/sos-feed', verifyToken, requireAdmin, async (req, res) => {
  try {
    const sosQuery = `
      SELECT 
        s.id AS incident_id,
        s.ride_id,
        s.user_id,
        u.name AS user_name,
        u.phone AS user_phone,
        s.incident_type,
        s.status,
        s.last_known_latitude,
        s.last_known_longitude,
        s.created_at,
        r.origin,
        r.destination
      FROM safety_incidents s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN rides r ON s.ride_id = r.id
      ORDER BY 
        CASE WHEN s.status = 'open' THEN 1 ELSE 2 END,
        s.created_at DESC
      LIMIT 50;
    `;
    const { rows } = await db.query(sosQuery);
    return res.status(200).json({ success: true, incidents: rows });
  } catch (error) {
    console.error('SOS feed fetch error:', error);
    return res.status(500).json({ error: 'Failed to fetch SOS feed' });
  }
});

// 3. Resolve SOS Incident
router.patch('/sos/:incidentId/resolve', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { incidentId } = req.params;
    const { resolution_notes } = req.body;
    const adminId = req.user.id;

    const { rows } = await db.query(
      `UPDATE safety_incidents 
       SET status = 'resolved',
           resolution_notes = $1,
           resolved_by = $2,
           resolved_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [resolution_notes || 'Resolved by Admin Desk', adminId, incidentId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Incident record nahi mila' });
    }

    return res.status(200).json({ success: true, message: 'Incident resolved', incident: rows[0] });
  } catch (error) {
    console.error('Resolve incident error:', error);
    return res.status(500).json({ error: 'Incident resolve karte waqt error aaya' });
  }
});

// 4. Pending Document Verifications Queue
router.get('/verifications/pending', verifyToken, requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT 
        id, name, email, phone, role, document_type, document_number_masked,
        document_url, verification_status, created_at
      FROM users 
      WHERE verification_status = 'pending'
      ORDER BY updated_at ASC;
    `;
    const { rows } = await db.query(query);
    return res.status(200).json({ success: true, queue: rows });
  } catch (error) {
    console.error('Pending verifications error:', error);
    return res.status(500).json({ error: 'Verification queue fetch failed' });
  }
});

// 5. Live Ride Supervision (Track ongoing & scheduled rides)
router.get('/rides/live', verifyToken, requireAdmin, async (req, res) => {
  try {
    const query = `
      SELECT 
        r.id,
        r.driver_id,
        u.name AS driver_name,
        u.phone AS driver_phone,
        r.origin,
        r.destination,
        r.departure_time,
        r.seats_available,
        r.total_seats,
        r.price_per_seat,
        r.status
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      WHERE r.status IN ('scheduled', 'in_progress')
      ORDER BY r.departure_time ASC
      LIMIT 100;
    `;
    const { rows } = await db.query(query);
    return res.status(200).json({ success: true, rides: rows });
  } catch (error) {
    console.error('Live rides supervision error:', error);
    return res.status(500).json({ error: 'Failed to fetch live rides' });
  }
});

module.exports = router;