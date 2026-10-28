const express = require('express');
const router = express.Router();
const db = require('../config/db');

// 1. Get all active Countries
router.get('/countries', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT DISTINCT country FROM locations_master WHERE is_active = TRUE ORDER BY country ASC'
    );
    res.json({ success: true, countries: result.rows.map(r => r.country) });
  } catch (err) {
    console.error('Fetch countries error:', err);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

// 2. Get States by Country
router.get('/states/:country', async (req, res) => {
  try {
    const { country } = req.params;
    const result = await db.query(
      'SELECT DISTINCT state FROM locations_master WHERE country = $1 AND is_active = TRUE ORDER BY state ASC',
      [country]
    );
    res.json({ success: true, states: result.rows.map(r => r.state) });
  } catch (err) {
    console.error('Fetch states error:', err);
    res.status(500).json({ error: 'Failed to fetch states' });
  }
});

// 3. Get Cities by State
router.get('/cities/:state', async (req, res) => {
  try {
    const { state } = req.params;
    const result = await db.query(
      'SELECT DISTINCT city, city_tier FROM locations_master WHERE state = $1 AND is_active = TRUE ORDER BY city ASC',
      [state]
    );
    res.json({ success: true, cities: result.rows });
  } catch (err) {
    console.error('Fetch cities error:', err);
    res.status(500).json({ error: 'Failed to fetch cities' });
  }
});

// 4. Get Areas & PIN codes by City (Pick/Drop selection ke liye)
router.get('/areas/:city', async (req, res) => {
  try {
    const { city } = req.params;
    const result = await db.query(
      `SELECT id, area_name, landmark_type, pincode, latitude, longitude 
       FROM locations_master 
       WHERE city = $1 AND is_active = TRUE 
       ORDER BY area_name ASC`,
      [city]
    );
    res.json({ success: true, areas: result.rows });
  } catch (err) {
    console.error('Fetch areas error:', err);
    res.status(500).json({ error: 'Failed to fetch areas' });
  }
});

// 5. Smart Search (By Area, City or PIN Code)
router.get('/search', async (req, res) => {
  try {
    const { query, city } = req.query;
    if (!query) return res.json({ success: true, results: [] });

    let sql = `SELECT * FROM locations_master WHERE (area_name ILIKE $1 OR city ILIKE $1 OR pincode ILIKE $1) AND is_active = TRUE`;
    let params = [`%${query}%`];

    if (city) {
      sql += ` AND city = $2`;
      params.push(city);
    }

    sql += ` LIMIT 15`;
    const result = await db.query(sql, params);
    res.json({ success: true, results: result.rows });
  } catch (err) {
    console.error('Location search error:', err);
    res.status(500).json({ error: 'Location search failed' });
  }
});

// 6. Live Ride Tracking Endpoint (For Tracking)
router.post('/track-ride', async (req, res) => {
  try {
    const { ride_id, current_lat, current_lng, speed_kmh, heading } = req.body;
    if (!ride_id || current_lat === undefined || current_lng === undefined) {
      return res.status(400).json({ error: 'Ride ID and coordinates are required.' });
    }

    await db.query(
      `INSERT INTO ride_tracking (ride_id, current_lat, current_lng, speed_kmh, heading, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (ride_id) 
       DO UPDATE SET current_lat = $2, current_lng = $3, speed_kmh = $4, heading = $5, updated_at = NOW()`,
      [ride_id, current_lat, current_lng, speed_kmh || 0, heading || 'North']
    );

    res.json({ success: true, message: 'Tracking updated successfully' });
  } catch (err) {
    console.error('Tracking update error:', err);
    res.status(500).json({ error: 'Failed to update tracking' });
  }
});

// 7. Get City-Specific Offers (For Targeted Offers & Planning)
router.get('/offers/:city', async (req, res) => {
  try {
    const { city } = req.params;
    const result = await db.query(
      `SELECT * FROM location_offers 
       WHERE LOWER(applicable_city) = LOWER($1) AND valid_till > NOW() AND is_active = TRUE`,
      [city]
    );
    res.json({ success: true, offers: result.rows });
  } catch (err) {
    console.error('Fetch offers error:', err);
    res.status(500).json({ error: 'Failed to fetch city offers' });
  }
});

module.exports = router;