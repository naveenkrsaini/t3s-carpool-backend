// File: routes/rideLifecycleRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken, requireDriver } = require('../middlewares/auth');
const { sendPushNotificationToUser } = require('../services/notificationService');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTP_4_DIGIT_REGEX = /^\d{4}$/;

function normalizeLang(lang) {
  const value = (lang || '').toLowerCase().trim();
  if (value === 'en' || value === 'english') return 'en';
  if (value === 'hi' || value === 'hindi') return 'hi';
  return 'hinglish';
}

function getCopy(lang) {
  const activeLang = normalizeLang(lang);

  if (activeLang === 'en') {
    return {
      missingOtpFields: 'ride_id, booking_id, and entered_otp are required.',
      invalidIdFormat: 'Invalid ride_id or booking_id format.',
      invalidOtpFormat: 'OTP must be a 4-digit numeric code.',
      rideNotFound: 'Ride not found.',
      unauthorizedDriver: 'You are not the authorized driver for this ride.',
      invalidRideStateForOtp: (status) => `OTP cannot be verified while ride status is ${status}.`,
      bookingNotFound: 'Booking not found for this ride.',
      bookingNotConfirmed: (status) => `Booking is not active (current status: ${status}).`,
      otpAlreadyVerified: 'Passenger OTP has already been verified.',
      otpMismatch: 'Invalid OTP. Please verify the 4-digit OTP with the passenger.',
      otpVerifiedSuccess: 'Boarding OTP verified successfully!',
      pushBoardingTitle: 'Boarding Verified',
      pushBoardingBody: 'Your boarding OTP has been verified. Have a safe trip!',
      invalidRideId: 'Invalid ride ID format.',
      cannotStartRide: (status) => `Ride cannot be started from status: ${status}.`,
      rideStartedSuccess: 'Ride is now in progress.',
      pushRideStartedTitle: 'Ride Started',
      pushRideStartedBody: 'Your ride has started.',
      cannotCompleteRide: 'Only an in-progress ride can be marked as completed.',
      rideCompletedSuccess: 'Trip marked as completed successfully.',
      pushRideCompletedTitle: 'Trip Completed',
      pushRideCompletedBody: 'You have reached your destination. Please rate your trip!',
      serverErrorOtp: 'Server error while verifying OTP.',
      serverErrorStart: 'Server error while starting ride.',
      serverErrorComplete: 'Server error while completing ride.',
    };
  }

  if (activeLang === 'hi') {
    return {
      missingOtpFields: 'ride_id, booking_id और entered_otp तीनों आवश्यक हैं।',
      invalidIdFormat: 'अमान्य ride_id या booking_id प्रारूप।',
      invalidOtpFormat: 'OTP 4 अंकों का संख्यात्मक कोड होना चाहिए।',
      rideNotFound: 'राइड नहीं मिली।',
      unauthorizedDriver: 'आप इस राइड के अधिकृत ड्राइवर नहीं हैं।',
      invalidRideStateForOtp: (status) => `राइड की वर्तमान स्थिति (${status}) में OTP सत्यापित नहीं हो सकता।`,
      bookingNotFound: 'इस राइड के लिए बुकिंग नहीं मिली।',
      bookingNotConfirmed: (status) => `बुकिंग सक्रिय नहीं है (स्थिति: ${status})।`,
      otpAlreadyVerified: 'यात्री का OTP पहले ही सत्यापित हो चुका है।',
      otpMismatch: 'अमान्य OTP। कृपया यात्री से सही 4-अंकों का OTP पुष्टि करें।',
      otpVerifiedSuccess: 'बोर्डिंग OTP सफलतापूर्वक सत्यापित हो गया है!',
      pushBoardingTitle: 'बोर्डिंग सत्यापित',
      pushBoardingBody: 'आपका बोर्डिंग OTP सत्यापित हो गया है। शुभ यात्रा!',
      invalidRideId: 'अमान्य राइड ID प्रारूप।',
      cannotStartRide: (status) => `वर्तमान स्थिति (${status}) से राइड शुरू नहीं की जा सकती।`,
      rideStartedSuccess: 'राइड अब शुरू हो चुकी है।',
      pushRideStartedTitle: 'राइड शुरू हुई',
      pushRideStartedBody: 'आपकी राइड शुरू हो गई है।',
      cannotCompleteRide: 'केवल शुरू की गई (in_progress) राइड को ही पूर्ण किया जा सकता है।',
      rideCompletedSuccess: 'यात्रा सफलतापूर्वक पूर्ण हो गई है।',
      pushRideCompletedTitle: 'यात्रा पूर्ण',
      pushRideCompletedBody: 'आप अपने गंतव्य पर पहुँच गए हैं। कृपया अपनी राइड को रेटिंग दें!',
      serverErrorOtp: 'OTP सत्यापित करते समय सर्वर त्रुटि आई।',
      serverErrorStart: 'राइड शुरू करते समय सर्वर त्रुटि आई।',
      serverErrorComplete: 'यात्रा पूर्ण करते समय सर्वर त्रुटि आई।',
    };
  }

  return {
    missingOtpFields: 'ride_id, booking_id, aur entered_otp teeno zaroori hain.',
    invalidIdFormat: 'Invalid ride_id ya booking_id format.',
    invalidOtpFormat: 'OTP 4-digit numeric hona chahiye.',
    rideNotFound: 'Ride nahi mili.',
    unauthorizedDriver: 'Aap is ride ke authorized driver nahi hain.',
    invalidRideStateForOtp: (status) => `Is ride status (${status}) mein OTP verify nahi ho sakta.`,
    bookingNotFound: 'Is ride ke liye booking nahi mili.',
    bookingNotConfirmed: (status) => `Booking active nahi hai (Status: ${status}).`,
    otpAlreadyVerified: 'Passenger ka OTP pehle hi verify ho chuka hai.',
    otpMismatch: 'Invalid OTP. Kripya passenger se sahi 4-digit OTP confirm karein.',
    otpVerifiedSuccess: 'Boarding OTP successfully verify ho gaya hai!',
    pushBoardingTitle: 'Boarding Verified',
    pushBoardingBody: 'Aapka Boarding OTP successfully verify ho gaya hai. Shubh yatra!',
    invalidRideId: 'Invalid ride ID format.',
    cannotStartRide: (status) => `Ride start nahi ho sakti. Vartaman status: ${status}.`,
    rideStartedSuccess: 'Ride officially shuru (in_progress) ho gayi hai.',
    pushRideStartedTitle: 'Ride Started',
    pushRideStartedBody: 'Aapki ride shuru ho gayi hai.',
    cannotCompleteRide: "Keval 'in_progress' ride ko hi complete kiya ja sakta hai.",
    rideCompletedSuccess: 'Trip safaltapoorvak complete mark ho gayi hai.',
    pushRideCompletedTitle: 'Trip Completed',
    pushRideCompletedBody: 'Aap apne drop point par pahunch gaye hain. Kripya ride ka feedback aur rating dein!',
    serverErrorOtp: 'OTP verify karte waqt server error aaya.',
    serverErrorStart: 'Ride start karne me error aaya.',
    serverErrorComplete: 'Trip complete karte waqt error aaya.',
  };
}

// 1. Driver Side: Verify Passenger 4-Digit Ride Start OTP
router.post('/verify-otp', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  const driverCopy = getCopy(req.user.preferred_language);
  let riderNotification = null;

  try {
    const { ride_id, booking_id, entered_otp } = req.body;
    const driver_id = req.user.id;
    const cleanOtp =
      typeof entered_otp === 'string'
        ? entered_otp.trim()
        : String(entered_otp ?? '').trim();

    if (!ride_id || !booking_id || !cleanOtp) {
      return res.status(400).json({ success: false, error: driverCopy.missingOtpFields });
    }

    if (!UUID_REGEX.test(ride_id) || !UUID_REGEX.test(booking_id)) {
      return res.status(400).json({ success: false, error: driverCopy.invalidIdFormat });
    }

    if (!OTP_4_DIGIT_REGEX.test(cleanOtp)) {
      return res.status(400).json({ success: false, error: driverCopy.invalidOtpFormat });
    }

    await client.query('BEGIN');

    const rideCheck = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1 FOR UPDATE`,
      [ride_id]
    );

    if (rideCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: driverCopy.rideNotFound });
    }

    if (rideCheck.rows[0].driver_id !== driver_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: driverCopy.unauthorizedDriver });
    }

    if (!['scheduled', 'in_progress'].includes(rideCheck.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: driverCopy.invalidRideStateForOtp(rideCheck.rows[0].status),
      });
    }

    const bookingCheck = await client.query(
      `SELECT id, rider_id, ride_id, ride_otp, is_otp_verified, booking_status
       FROM bookings
       WHERE id = $1 AND ride_id = $2
       FOR UPDATE`,
      [booking_id, ride_id]
    );

    if (bookingCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: driverCopy.bookingNotFound });
    }

    const booking = bookingCheck.rows[0];

    if (booking.booking_status !== 'confirmed') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: driverCopy.bookingNotConfirmed(booking.booking_status),
      });
    }

    if (booking.is_otp_verified) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: driverCopy.otpAlreadyVerified });
    }

    if (String(booking.ride_otp).trim() !== cleanOtp) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: driverCopy.otpMismatch });
    }

    await client.query(
      `UPDATE bookings
       SET is_otp_verified = TRUE
       WHERE id = $1`,
      [booking_id]
    );

    const riderRes = await client.query(
      `SELECT preferred_language FROM users WHERE id = $1`,
      [booking.rider_id]
    );
    const riderCopy = getCopy(riderRes.rows[0]?.preferred_language);

    await client.query('COMMIT');

    riderNotification = {
      riderId: booking.rider_id,
      title: riderCopy.pushBoardingTitle,
      body: riderCopy.pushBoardingBody,
    };

    if (riderNotification.riderId) {
      sendPushNotificationToUser(
        riderNotification.riderId,
        riderNotification.title,
        riderNotification.body,
        { ride_id, booking_id, type: 'BOARDING_VERIFIED', ui_intent: 'success' }
      ).catch((err) => console.error('Push notification failed:', err.message));
    }

    return res.status(200).json({
      success: true,
      message: driverCopy.otpVerifiedSuccess,
      booking_id,
      is_otp_verified: true,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('OTP verification error:', error);
    return res.status(500).json({ success: false, error: driverCopy.serverErrorOtp });
  } finally {
    client.release();
  }
});

// 2. Driver Side: Start Ride ('scheduled' -> 'in_progress')
router.patch('/:id/start', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  const driverCopy = getCopy(req.user.preferred_language);
  let ridersToNotify = [];

  try {
    const rideId = req.params.id;
    const driverId = req.user.id;

    if (!UUID_REGEX.test(rideId)) {
      return res.status(400).json({ success: false, error: driverCopy.invalidRideId });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: driverCopy.rideNotFound });
    }

    const ride = rows[0];
    if (ride.driver_id !== driverId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: driverCopy.unauthorizedDriver });
    }

    if (ride.status !== 'scheduled') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: driverCopy.cannotStartRide(ride.status),
      });
    }

    const updated = await client.query(
      `UPDATE rides
       SET status = 'in_progress', started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, status, started_at`,
      [rideId]
    );

    const ridersRes = await client.query(
      `SELECT b.rider_id, u.preferred_language
       FROM bookings b
       JOIN users u ON b.rider_id = u.id
       WHERE b.ride_id = $1 AND b.booking_status = 'confirmed'`,
      [rideId]
    );
    ridersToNotify = ridersRes.rows;

    await client.query('COMMIT');

    ridersToNotify.forEach((rider) => {
      const rCopy = getCopy(rider.preferred_language);
      sendPushNotificationToUser(
        rider.rider_id,
        rCopy.pushRideStartedTitle,
        rCopy.pushRideStartedBody,
        { ride_id: rideId, type: 'RIDE_STARTED', ui_intent: 'info' }
      ).catch((err) => console.error('Push notification failed:', err.message));
    });

    return res.status(200).json({
      success: true,
      message: driverCopy.rideStartedSuccess,
      ride: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Start ride error:', error);
    return res.status(500).json({ success: false, error: driverCopy.serverErrorStart });
  } finally {
    client.release();
  }
});

// 3. Driver Side: Complete Ride ('in_progress' -> 'completed')
router.patch('/:id/complete', verifyToken, requireDriver, async (req, res) => {
  const client = await db.pool.connect();
  const driverCopy = getCopy(req.user.preferred_language);
  let confirmedRiders = [];

  try {
    const rideId = req.params.id;
    const driverId = req.user.id;

    if (!UUID_REGEX.test(rideId)) {
      return res.status(400).json({ success: false, error: driverCopy.invalidRideId });
    }

    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT id, driver_id, status FROM rides WHERE id = $1 FOR UPDATE`,
      [rideId]
    );

    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: driverCopy.rideNotFound });
    }

    const ride = rows[0];
    if (ride.driver_id !== driverId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, error: driverCopy.unauthorizedDriver });
    }

    if (ride.status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: driverCopy.cannotCompleteRide });
    }

    const updated = await client.query(
      `UPDATE rides
       SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, status, completed_at`,
      [rideId]
    );

    await client.query(
      `UPDATE bookings
       SET payment_status = 'completed'
       WHERE ride_id = $1 AND booking_status = 'confirmed' AND payment_status = 'pending'`,
      [rideId]
    );

    const bookedRiders = await client.query(
      `SELECT b.rider_id, u.preferred_language
       FROM bookings b
       JOIN users u ON b.rider_id = u.id
       WHERE b.ride_id = $1 AND b.booking_status = 'confirmed'`,
      [rideId]
    );
    confirmedRiders = bookedRiders.rows;

    await client.query('COMMIT');

    confirmedRiders.forEach((rider) => {
      const rCopy = getCopy(rider.preferred_language);
      sendPushNotificationToUser(
        rider.rider_id,
        rCopy.pushRideCompletedTitle,
        rCopy.pushRideCompletedBody,
        { ride_id: rideId, type: 'RIDE_COMPLETED', ui_intent: 'success' }
      ).catch((err) => console.error('Push notification failed:', err.message));
    });

    return res.status(200).json({
      success: true,
      message: driverCopy.rideCompletedSuccess,
      ride: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Complete ride error:', error);
    return res.status(500).json({ success: false, error: driverCopy.serverErrorComplete });
  } finally {
    client.release();
  }
});

module.exports = router;