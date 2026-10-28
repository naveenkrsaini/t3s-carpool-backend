// utils/couponEngine.js

/**
 * Coupon validation aur discount calculation
 * @param {object} coupon - Database coupon record
 * @param {number} bookingAmount - Ride fare before discount
 */
const evaluateCouponDiscount = (coupon, bookingAmount) => {
  const now = new Date();
  const amount = parseFloat(bookingAmount) || 0;

  // 1. Expiry check
  if (coupon.valid_until && new Date(coupon.valid_until) < now) {
    return { isValid: false, reason: 'Yeh coupon expire ho chuka hai.' };
  }

  // 2. Minimum booking amount check
  const minBooking = parseFloat(coupon.min_booking_amount) || 0;
  if (amount < minBooking) {
    return {
      isValid: false,
      reason: `Is coupon ko apply karne ke liye minimum booking amount ₹${minBooking} hona zaroori hai.`,
    };
  }

  // 3. Usage limit check
  if (coupon.usage_limit !== null && coupon.times_used >= coupon.usage_limit) {
    return { isValid: false, reason: 'Is coupon ka maximum usage limit poora ho chuka hai.' };
  }

  // 4. Discount calculation
  let discount = 0;
  const discountVal = parseFloat(coupon.discount_value);

  if (coupon.discount_type === 'percentage') {
    discount = (amount * discountVal) / 100;
    if (coupon.max_discount_amount) {
      discount = Math.min(discount, parseFloat(coupon.max_discount_amount));
    }
  } else if (coupon.discount_type === 'flat') {
    discount = Math.min(discountVal, amount);
  }

  discount = Math.round(discount * 100) / 100;
  const finalPayable = Math.max(0, Math.round((amount - discount) * 100) / 100);

  return {
    isValid: true,
    discountAmount: discount,
    finalPayable,
    couponCode: coupon.code,
  };
};

module.exports = { evaluateCouponDiscount };