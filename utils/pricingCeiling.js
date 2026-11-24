// utils/pricingCeiling.js
const BASE_FUEL_RATES = {
  electric: 4.0,
  cng: 5.0,
  petrol: 8.0,
  diesel: 6.5,
  default: 7.0,
};

const calculateLegalCeiling = (
  distanceKm,
  availableSeats,
  tollCharges = 0,
  vehicleType = 'sedan',
  fuelType = 'petrol',
  vehicleCategory = 'car_5_seater'
) => {
  const cleanDistance = Math.max(1, parseFloat(distanceKm) || 1);
  const cleanSeats = Math.max(1, parseInt(availableSeats, 10) || 1);
  const cleanToll = Math.max(0, parseFloat(tollCharges) || 0);

  let ratePerKm = BASE_FUEL_RATES[fuelType?.toLowerCase()] || BASE_FUEL_RATES.default;

  const vType = (vehicleType || vehicleCategory || '').toLowerCase();
  if (vType.includes('suv')) ratePerKm *= 1.3;
  else if (vType.includes('traveller') || vType.includes('bus')) ratePerKm *= 1.8;
  else if (vType.includes('2_wheeler') || vType.includes('bike') || vType.includes('scooty')) {
    ratePerKm *= 0.5;
  }

  const totalTripCost = cleanDistance * ratePerKm + cleanToll;
  const totalTripMembers = 1 + cleanSeats;
  const rawCeilingPerSeat = totalTripCost / totalTripMembers;
  const maxAllowedPricePerSeat = Math.ceil(rawCeilingPerSeat / 5) * 5;

  return {
    distanceKm: cleanDistance,
    ratePerKm: Math.round(ratePerKm * 100) / 100,
    totalTripCost: Math.round(totalTripCost * 100) / 100,
    tollCharges: cleanToll,
    maxAllowedPricePerSeat,
    minRecommendedPricePerSeat: Math.max(10, Math.floor((maxAllowedPricePerSeat * 0.4) / 5) * 5),
  };
};

module.exports = {
  calculateLegalCeiling,
};