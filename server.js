// server.js
require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

// Database Pool Import
const db = require('./config/db');

// Middlewares & Services
const { sanitizeInput } = require('./middlewares/sanitize');
const { verifyToken } = require('./middlewares/auth');
const { initCronJobs } = require('./services/cronService');
const { helmetMiddleware, corsMiddleware, apiLimiter, authLimiter } = require('./middlewares/security');

// Import Modular Routes
const authRoutes = require('./routes/auth');
const locationRoutes = require('./routes/locationRoutes');
const rideRoutes = require('./routes/rides');
const bookingRoutes = require('./routes/bookingRoutes');
const rideLifecycleRoutes = require('./routes/rideLifecycleRoutes');
const safetyRoutes = require('./routes/safetyRoutes');
const disputeRoutes = require('./routes/disputeRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const couponRoutes = require('./routes/couponRoutes');
const planRoutes = require('./routes/planRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const badgeRoutes = require('./routes/badgeRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const profileRoutes = require('./routes/profileRoutes');
const adminRoutes = require('./routes/adminRoutes');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 1. Initialize Express and HTTP Server
const app = express();
const server = http.createServer(app);

// 2. Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*',
    methods: ['GET', 'POST'],
  },
});

// Real-time Chat Socket Engine initialize karein
try {
  require('./sockets/chatSocket')(io);
} catch (e) {
  console.log('Chat socket module optional/loaded:', e.message);
}

// 3. Security & Body Middlewares
app.use(helmetMiddleware);
app.use(corsMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (typeof sanitizeInput === 'function') {
  app.use(sanitizeInput);
}

// Serve Static Uploads (Documents/Avatars)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Rate Limiters
app.use('/api/', apiLimiter);
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/verification/send-otp', authLimiter);
app.use('/api/verification/verify-otp', authLimiter);

// ==========================================
// 4. MOUNTING API ROUTES
// ==========================================
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/rides', rideRoutes);
app.use('/locations', locationRoutes);
app.use('/api/rides', rideRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/badges', badgeRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/profile', profileRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/rides/lifecycle', rideLifecycleRoutes);
app.use('/api/safety', safetyRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);

// Ride Chat History Endpoint
app.get('/api/rides/:ride_id/messages', verifyToken, async (req, res) => {
  try {
    const { ride_id } = req.params;
    if (!UUID_REGEX.test(ride_id)) {
      return res.status(400).json({ success: false, error: 'Invalid ride ID format' });
    }

    const { rows } = await db.query(
      `SELECT m.id, m.ride_id, m.sender_id, u.name AS sender_name, m.message, m.created_at
       FROM ride_messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.ride_id = $1
       ORDER BY m.created_at ASC`,
      [ride_id]
    );
    return res.json({ success: true, messages: rows });
  } catch (err) {
    console.error('Fetch chat history error:', err.message);
    return res.status(500).json({ success: false, error: 'Chat history fetch karne mein samasya aayi' });
  }
});

// Root & Health Routes
app.get('/', (_req, res) => {
  res.send('Carpooling Backend API is running!');
});

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'online',
    timestamp: new Date().toISOString(),
    database: 'Supabase PostgreSQL',
    realtime: 'Socket.io Active',
  });
});

// Authenticated User Push Token Registration Route
app.patch('/users/:userId/push-token', verifyToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { push_token } = req.body;

    if (!UUID_REGEX.test(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    if (req.user.id !== userId) {
      return res.status(403).json({ success: false, error: 'Unauthorized push token update' });
    }

    if (!push_token || typeof push_token !== 'string' || !push_token.trim()) {
      return res.status(400).json({ success: false, error: 'Push token anivarya hai' });
    }

    await db.query(
      'UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2',
      [push_token.trim(), userId]
    );

    return res.json({ success: true, message: 'Push token safalta se update ho gaya' });
  } catch (err) {
    console.error('Push token update error:', err.message);
    return res.status(500).json({ success: false, error: 'Push token update fail ho gaya' });
  }
});

// ==========================================
// 5. REAL-TIME SOCKET.IO EVENT HANDLERS
// ==========================================
io.on('connection', (socket) => {
  console.log(`🔌 Client connected to Socket: ${socket.id}`);

  socket.on('join_ride_tracking', ({ ride_id }) => {
    if (ride_id) {
      socket.join(`ride_${ride_id}`);
      console.log(`Socket ${socket.id} joined room: ride_${ride_id}`);
    }
  });

  socket.on('driver_location_update', ({ ride_id, latitude, longitude, heading, speed }) => {
    if (!ride_id || typeof latitude !== 'number' || typeof longitude !== 'number') return;

    socket.to(`ride_${ride_id}`).emit('live_location_received', {
      ride_id,
      latitude,
      longitude,
      heading: heading || 0,
      speed: speed || 0,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('leave_ride_tracking', ({ ride_id }) => {
    if (ride_id) {
      socket.leave(`ride_${ride_id}`);
      console.log(`Socket ${socket.id} left room: ride_${ride_id}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// ==========================================
// 6. CENTRAL ERROR HANDLER
// ==========================================
app.use((err, _req, res, _next) => {
  console.error('Unhandled Error:', err.stack);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    success: false,
    error: isProduction ? 'Internal Server Error' : err.message || 'Internal Server Error',
  });
});

// ==========================================
// 7. START SERVER & BACKGROUND WORKERS
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Carpooling Backend Server running on port ${PORT}`);

  try {
    if (typeof initCronJobs === 'function') initCronJobs();
  } catch (err) {
    console.log('Cron job initialization skipped or failed:', err.message);
  }
});