// middlewares/security.js
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

// 1. Strict CORS Configuration
const allowedOrigins = [
  'http://localhost:8081', // Expo local development
  'http://localhost:3000',
  'https://yourdomain.com', // Production domain
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, Postman, curl)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('CORS Policy Block: Origin not allowed.'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

// 2. General API Rate Limiter (Prevent DDOS / Spam)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 150, // Limit each IP to 150 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Bahut zyada requests aa gayi hain. Kripya 15 minutes baad prayas karein.',
  },
});

// 3. Stricter Rate Limiter for Auth, OTP, & Verification (Prevent Brute-Force)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15, // Limit each IP to 15 attempts per hour for OTP/Login
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Suraksha kaaranon se yeh action temporarily block hai. 1 ghante baad try karein.',
  },
});

module.exports = {
  helmetMiddleware: helmet(),
  corsMiddleware: cors(corsOptions),
  apiLimiter,
  authLimiter,
};