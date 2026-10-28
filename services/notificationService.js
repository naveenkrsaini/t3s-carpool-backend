// services/notificationService.js
const { Expo } = require('expo-server-sdk');
const db = require('../config/db');

const expo = new Expo();

/**
 * Expo Push API ke dwara target user ko notification bhejna
 * @param {string} userId User ID
 * @param {string} title Notification title
 * @param {string} body Notification message
 * @param {object} data Metadata payload
 */
const sendPushNotificationToUser = async (userId, title, body, data = {}) => {
  try {
    const userQuery = await db.query(
      `SELECT push_token, name FROM users WHERE id = $1`,
      [userId]
    );

    if (userQuery.rows.length === 0) {
      console.warn(`[Push Notification] User nahi mila: ${userId}`);
      return false;
    }

    const { push_token: pushToken } = userQuery.rows[0];

    if (!pushToken || !Expo.isExpoPushToken(pushToken)) {
      console.log(`[Push Notification] Valid push token absent for user: ${userId}`);
      return false;
    }

    const messages = [{
      to: pushToken,
      sound: 'default',
      title,
      body,
      data,
      priority: 'high',
    }];

    const chunks = expo.chunkPushNotifications(messages);
    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        console.log('Push notification sent successfully:', ticketChunk);
      } catch (error) {
        console.error('Error sending push chunk:', error);
      }
    }
    return true;
  } catch (error) {
    console.error('[Push Notification Error]:', error.message);
    return false;
  }
};

module.exports = { sendPushNotificationToUser };