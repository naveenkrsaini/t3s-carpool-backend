// routes/rideMatchingRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middlewares/auth');

// Haversine formula to calculate distance in KM between two lat/lng points
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in KM
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in KM
}

// 🔹 SEARCH & MATCH RIDES ENDPOINT
router.post('/find-matches', verifyToken, async (req, res) => {
  try {
    const { pickup_lat, pickup_lng, drop_lat, drop_lng, city, target_date } = req.body;

    if (!pickup_lat || !pickup_lng || !drop_lat || !drop_lng || !city) {
      return res.status(400).json({ error: 'Pickup aur Drop coordinates zaroori hain.' });
    }

    // 1. Fetch active rides hosted by drivers in the same city for the target date
    const ridesQuery = `
      r.*, u.name as driver_name, u.rating as driver_rating, v.vehicle_model, v.vehicle_number, v.color
      FROM rides r
      JOIN users u ON r.driver_id = u.id
      LEFT JOIN vehicles v ON r.driver_id = v.driver_id
      WHERE LOWER(r.city) = LOWER($1) AND r.status = 'active' AND r.available_seats > 0
    `;
    const result = await db.query(`SELECT ${ridesQuery}`, [city]);
    const availableRides = result.rows;

    // 2. Score and filter rides based on proximity
    const matchedRides = availableRides.map(ride => {
      // Calculate distance from rider's pickup to driver's ride pickup
      const pickupDistance = calculateDistance(pickup_lat, pickup_lng, ride.pickup_lat, ride.pickup_lng);
      // Calculate distance from rider's drop to driver's ride drop
      const dropDistance = calculateDistance(drop_lat, drop_lng, ride.drop_lat, ride.drop_lng);

      // Total detour / distance mismatch score (lower is better)
      const totalMismatchScore = pickupDistance + dropDistance;

      return {
        ...ride,
        pickup_distance_km: parseFloat(pickupDistance.toFixed(2)),
        drop_distance_km: parseFloat(dropDistance.toFixed(2)),
        match_score: parseFloat(totalMismatchScore.toFixed(2))
      };
    })
    .filter(ride => ride.pickup_distance_km <= 10 && ride.drop_distance_km <= 10) // Only rides within 10km proximity
    .sort((a, b) => a.match_score - b.match_score); // Best matches first

    return res.status(200).json({
      success: true,
      count: matchedRides.length,
      matches: matchedRides
    });

  } catch (err) {
    console.error('Ride matching error:', err);
    res.status(500).json({ error: 'Ride matching process mein server error aaya.' });
  }
});

module.exports = router;