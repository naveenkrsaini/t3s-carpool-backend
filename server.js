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
const { initCronJobs } = require('./services/cronService');
const { startRideExpiryCron } = require('./workers/rideExpiryWorker');
const { helmetMiddleware, corsMiddleware, apiLimiter, authLimiter } = require('./middlewares/security');

// Import Modular Routes
const authRoutes = require('./routes/auth');
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

// 1. Initialize Express and HTTP Server
const app = express();
const server = http.createServer(app);

// 2. Socket.io Setup with CORS
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Real-time Chat Socket Engine initialize karein
try {
  require('./sockets/chatSocket')(io);
} catch (e) {
  console.log('Chat socket module optional/loaded:', e.message);
}

// 3. Security & Body Middlewares (Using centralized security module + body parsers)
app.use(helmetMiddleware);
app.use(corsMiddleware);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

if (typeof sanitizeInput === 'function') {
  app.use(sanitizeInput); // Incoming request sanitization
}

// Serve Static Uploads (Documents/Avatars)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Apply General Rate Limiter to all API routes
app.use('/api/', apiLimiter);

// Apply Stricter Rate Limiter specifically to Auth & Verification endpoints
app.use('/api/verification/send-otp', authLimiter);
app.use('/api/verification/verify-otp', authLimiter);

// ==========================================
// 4. MOUNTING API ROUTES
// ==========================================
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/rides', rideRoutes);
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

// Root route
app.get('/', (req, res) => {
  res.send('Carpooling Backend API is running!');
});

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    timestamp: new Date().toISOString(),
    database: 'Supabase PostgreSQL',
    realtime: 'Socket.io Active',
  });
});

// User Push Token Registration Route
app.patch('/users/:userId/push-token', async (req, res) => {
  try {
    const { userId } = req.params;
    const { push_token } = req.body;

    if (!push_token) {
      return res.status(400).json({ error: 'Push token anivarya hai' });
    }

    await db.query(
      'UPDATE users SET push_token = $1, updated_at = NOW() WHERE id = $2',
      [push_token, userId]
    );

    res.json({ success: true, message: 'Push token safalta se update ho gaya' });
  } catch (err) {
    console.error('Push token update error:', err.message);
    res.status(500).json({ error: 'Push token update fail ho gaya' });
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
    if (!ride_id || !latitude || !longitude) return;

    socket.to(`ride_${ride_id}`).emit('live_location_received', {
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
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err.stack);
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(err.status || 500).json({
    error: isProduction ? 'Internal Server Error' : err.message || 'Internal Server Error',
  });
});

// ==========================================
// 7. START SERVER & BACKGROUND WORKERS
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Carpooling Backend Server running on port ${PORT}`);
  
  // Start automated background tasks here after server is successfully running
  try {
    if (typeof initCronJobs === 'function') initCronJobs();
    if (typeof startRideExpiryCron === 'function') startRideExpiryCron();
  } catch (err) {
    console.log('Cron job initialization skipped or failed:', err.message);
  }
});

app.get('/api/rides/:ride_id/messages', async (req, res) => {
  try {
    const { ride_id } = req.params;
    const { rows } = await db.query(
      `SELECT m.id, m.ride_id, m.sender_id, u.name as sender_name, m.message, m.created_at 
       FROM ride_messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.ride_id = $1 
       ORDER BY m.created_at ASC`,
      [ride_id]
    );
    res.json({ success: true, messages: rows });
  } catch (err) {
    console.error('Fetch chat history error:', err.message);
    res.status(500).json({ error: 'Chat history fetch karne mein samasya aayi' });
  }
});