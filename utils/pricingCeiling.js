// utils/pricingCeiling.js

// Category ke hisaab se average operating cost per km (Fuel + Maintenance + Depreciation)
const VEHICLE_RATES_PER_KM = {
  hatchback: 6.5,   // ₹6.5/km
  sedan: 8.5,       // ₹8.5/km
  suv: 11.0,        // ₹11.0/km
  electric: 4.5,    // ₹4.5/km
  default: 7.5,     // Standard car fallback
};

/**
 * Legal Cost-Recovery Ceiling Calculate karein
 * @param {number} distanceKm - Total trip distance in kilometers
 * @param {number} availableSeats - Offered passenger seats (Excluding driver)
 * @param {number} tollCharges - Toll road charges (default 0)
 * @param {string} vehicleType - Vehicle category
 * @returns {object} Fare limits and breakdown
 */
const calculateLegalCeiling = (distanceKm, availableSeats, tollCharges = 0, vehicleType = 'default') => {
  const cleanDistance = Math.max(1, parseFloat(distanceKm) || 1);
  const cleanSeats = Math.max(1, parseInt(availableSeats) || 1);
  const cleanToll = Math.max(0, parseFloat(tollCharges) || 0);

  const ratePerKm = VEHICLE_RATES_PER_KM[vehicleType.toLowerCase()] || VEHICLE_RATES_PER_KM.default;
  
  // Total trip operational cost
  const totalTripCost = (cleanDistance * ratePerKm) + cleanToll;

  // Carpooling Rule: Total trip members = 1 Driver + Offered passenger seats
  const totalTripMembers = 1 + cleanSeats;

  // Driver cost-share ke baad per-seat maximum legal recovery ceiling
  const rawCeilingPerSeat = totalTripCost / totalTripMembers;

  // Minor round-off (₹5 buffer round up for clean pricing)
  const maxAllowedPricePerSeat = Math.ceil(rawCeilingPerSeat / 5) * 5;

  return {
    distanceKm: cleanDistance,
    ratePerKm,
    totalTripCost: Math.round(totalTripCost * 100) / 100,
    maxAllowedPricePerSeat,
    minRecommendedPricePerSeat: Math.max(10, Math.floor((maxAllowedPricePerSeat * 0.4) / 5) * 5),
  };
};

module.exports = {
  calculateLegalCeiling,
  VEHICLE_RATES_PER_KM,
};