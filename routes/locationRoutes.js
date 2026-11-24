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
    // Frontend se 'q' aayega, fallback ke liye 'query' rakha hai
    const searchQuery = req.query.q || req.query.query; 

    // Server load bachane ke liye kam se kam 3 characters zaroori hain
    if (!searchQuery || searchQuery.trim().length < 3) {
       return res.json({ success: true, results: [] }); 
    }

    // SQL query mein AS lagakar column names frontend ke hisab se set kiye hain
    let sql = `
      SELECT 
        id, 
        area_name AS area, 
        city, 
        state, 
        country, 
        pincode, 
        latitude AS lat, 
        longitude AS lng,
        landmark_type,
        city_tier
      FROM locations_master 
      WHERE (area_name ILIKE $1 OR city ILIKE $1 OR state ILIKE $1 OR pincode ILIKE $1) 
        AND is_active = TRUE
      LIMIT 15
    `;
    
    let params = [`%${searchQuery.trim()}%`];
    
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


// 8. Auto-Save External/OSM Locations for Future & Admin Verification
router.post('/save-external', async (req, res) => {
  try {
    const { area, city, state, country, pincode, lat, lng } = req.body;

    if (!area || !city || !lat || !lng) {
      return res.status(400).json({ error: 'Required fields missing' });
    }

    // Pehle check karein ki yeh exact coordinates (ya area) pehle se DB mein toh nahi hai
    const checkDuplicate = await db.query(
      `SELECT id FROM locations_master 
       WHERE (latitude = $1 AND longitude = $2) OR (LOWER(area_name) = LOWER($3) AND LOWER(city) = LOWER($4))
       LIMIT 1`,
      [lat, lng, area, city]
    );

    if (checkDuplicate.rows.length > 0) {
      return res.status(200).json({ success: true, message: 'Location already exists in DB' });
    }

    // Nayi location ko 'pending' status ke sath save karein
    const insertQuery = `
      INSERT INTO locations_master 
        (area_name, city, state, country, pincode, latitude, longitude, is_active, source, approval_status, city_tier, landmark_type)
      VALUES 
        ($1, $2, $3, $4, $5, $6, $7, TRUE, 'osm_auto', 'pending', 'Tier-Unknown', 'Auto-Discovered')
      RETURNING id
    `;
    
    await db.query(insertQuery, [
      area, city, state || '', country || 'India', pincode || '000000', lat, lng
    ]);

    return res.status(201).json({ success: true, message: 'New location cached for admin review' });
  } catch (err) {
    console.error('Auto-save location error:', err);
    return res.status(500).json({ error: 'Failed to auto-save location' });
  }
});

module.exports = router;