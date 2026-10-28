// sockets/chatSocket.js
const db = require('../config/db');

module.exports = (io) => {
  io.on('connection', (socket) => {
    // Ride Chat Room Join Karna
    socket.on('join_ride_chat', ({ ride_id }) => {
      socket.join(`chat_${ride_id}`);
    });

    // In-App Message Send Karna
    socket.on('send_ride_message', async ({ ride_id, sender_id, sender_name, message }) => {
      if (!ride_id || !sender_id || !message?.trim()) return;

      try {
        const cleanMsg = message.trim();

        // Database me save karein
        const { rows } = await db.query(
          `INSERT INTO ride_messages (ride_id, sender_id, message) 
           VALUES ($1, $2, $3) 
           RETURNING id, created_at`,
          [ride_id, sender_id, cleanMsg]
        );

        const payload = {
          id: rows[0].id,
          ride_id,
          sender_id,
          sender_name,
          message: cleanMsg,
          created_at: rows[0].created_at,
        };

        // Room ke sabhi participants ko real-time broadcast karein
        io.to(`chat_${ride_id}`).emit('new_ride_message', payload);
      } catch (err) {
        console.error('Socket chat error:', err.message);
      }
    });

    socket.on('leave_ride_chat', ({ ride_id }) => {
      socket.leave(`chat_${ride_id}`);
    });
  });
};