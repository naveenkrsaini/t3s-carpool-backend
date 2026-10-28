// config/db.js
const { Pool } = require('pg');

// Environment ke hisaab se .env ya .env.test load karein
if (process.env.NODE_ENV === 'test') {
  require('dotenv').config({ path: '.env.test', override: true });
} else {
  require('dotenv').config();
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false, },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV === 'test') {
    console.log('🧪 Connected to TEST Database (Supabase PostgreSQL)!');
  } else {
    console.log('✅ Successfully connected to Database Pool!');
  }
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle PostgreSQL client:', err);
  // process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,  
};
