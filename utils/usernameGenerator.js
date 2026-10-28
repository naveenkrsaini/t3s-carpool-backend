// utils/usernameGenerator.js
const db = require('../config/db');

async function generateUniqueUsername(firstName = 'user') {
  const sanitized = firstName.trim().toLowerCase().replace(/[^a-z0-9]/g, '') || 'rider';
  let isUnique = false;
  let candidateUsername = '';

  while (!isUnique) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000); // 4-digit number
    candidateUsername = `${sanitized}_${randomSuffix}`;

    const check = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [candidateUsername]);
    if (check.rows.length === 0) {
      isUnique = true;
    }
  }

  return candidateUsername;
}

module.exports = { generateUniqueUsername };