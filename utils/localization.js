// utils/localization.js
function normalizeBackendLang(lang) {
  const value = (lang || '').toLowerCase().trim();
  if (value === 'en' || value === 'english') return 'en';
  if (value === 'hi' || value === 'hindi') return 'hi';
  return 'hinglish';
}

const MESSAGES = {
  en: {
    otpVerifiedSuccess: 'Boarding OTP verified successfully!',
    pushBoardingTitle: 'Boarding Verified',
    pushBoardingBody: 'Your boarding OTP has been verified. Have a safe trip!',
    rideStartedSuccess: 'Ride is now in progress.',
    pushRideStartedTitle: 'Ride Started',
    pushRideStartedBody: 'Your ride has started.',
    rideCompletedSuccess: 'Trip marked as completed successfully.',
    pushRideCompletedTitle: 'Trip Completed',
    pushRideCompletedBody: 'You have reached your destination. Please rate your trip!',
  },
  hi: {
    otpVerifiedSuccess: 'बोर्डिंग OTP सफलतापूर्वक सत्यापित हो गया है!',
    pushBoardingTitle: 'बोर्डिंग सत्यापित',
    pushBoardingBody: 'आपका बोर्डिंग OTP सत्यापित हो गया है। शुभ यात्रा!',
    rideStartedSuccess: 'राइड अब शुरू हो चुकी है।',
    pushRideStartedTitle: 'राइड शुरू हुई',
    pushRideStartedBody: 'आपकी राइड शुरू हो गई है।',
    rideCompletedSuccess: 'यात्रा सफलतापूर्वक पूर्ण हो गई है।',
    pushRideCompletedTitle: 'यात्रा पूर्ण',
    pushRideCompletedBody: 'आप अपने गंतव्य पर पहुँच गए हैं। कृपया अपनी राइड को रेटिंग दें!',
  },
  hinglish: {
    otpVerifiedSuccess: 'Boarding OTP successfully verify ho gaya hai!',
    pushBoardingTitle: 'Boarding Verified',
    pushBoardingBody: 'Aapka Boarding OTP successfully verify ho gaya hai. Shubh yatra!',
    rideStartedSuccess: 'Ride officially shuru (in_progress) ho gayi hai.',
    pushRideStartedTitle: 'Ride Started',
    pushRideStartedBody: 'Aapki ride shuru ho gayi hai.',
    rideCompletedSuccess: 'Trip safaltapoorvak complete mark ho gayi hai.',
    pushRideCompletedTitle: 'Trip Completed',
    pushRideCompletedBody: 'Aap apne drop point par pahunch gaye hain. Kripya ride ka feedback aur rating dein!',
  },
};

function getLocalizedCopy(lang) {
  const normalized = normalizeBackendLang(lang);
  return MESSAGES[normalized] || MESSAGES.hinglish;
}

module.exports = { normalizeBackendLang, getLocalizedCopy };