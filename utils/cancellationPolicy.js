// utils/cancellationPolicy.js

/**
 * Cancellation charges aur refund eligibility calculate karein
 * @param {Date|string} departureTime - Ride departure timestamp
 * @param {number} totalAmount - Total paid/payable booking amount
 * @param {string} cancelledBy - 'rider' ya 'driver'
 */
const calculateCancellationPenalty = (departureTime, totalAmount, cancelledBy = 'rider') => {
  const now = new Date();
  const depTime = new Date(departureTime);
  const diffHours = (depTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  const cleanTotal = parseFloat(totalAmount) || 0;

  // Case 1: Agar Driver ne cancel kiya (Driver cancellation hamesha 100% refund hota hai rider ke liye)
  if (cancelledBy === 'driver') {
    return {
      penaltyAmount: 0,
      refundAmount: cleanTotal,
      penaltyPercentage: 0,
      reason: 'Driver dwara ride cancel kiye jaane par rider ko 100% refund milta hai.',
    };
  }

  // Case 2: Rider dwara ride cancel karna:
  // > 12 ghante pehle: Free Cancellation
  if (diffHours >= 12) {
    return {
      penaltyAmount: 0,
      refundAmount: cleanTotal,
      penaltyPercentage: 0,
      reason: 'Departure se 12 ghante se pehle cancel karne par 0 penalty (Full Refund).',
    };
  }

  // 2 se 12 ghante ke beech: Moderate 25% Cancellation Fee
  if (diffHours >= 2 && diffHours < 12) {
    const penalty = Math.round(cleanTotal * 0.25 * 100) / 100;
    return {
      penaltyAmount: penalty,
      refundAmount: Math.round((cleanTotal - penalty) * 100) / 100,
      penaltyPercentage: 25,
      reason: 'Departure se 2-12 ghante pehle cancel karne par 25% penalty charge lagta hai.',
    };
  }

  // < 2 ghante pehle ya departure ke baad: 50% Late Cancellation Fee (Driver compensation ke liye)
  const penalty = Math.round(cleanTotal * 0.50 * 100) / 100;
  return {
    penaltyAmount: penalty,
    refundAmount: Math.round((cleanTotal - penalty) * 100) / 100,
    penaltyPercentage: 50,
    reason: 'Departure ke 2 ghante ke bheetar cancel karne par 50% late cancellation penalty lagti hai.',
  };
};

module.exports = { calculateCancellationPenalty };