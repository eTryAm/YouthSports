/**
 * Applies the additive multi-tournament migration.
 * It never drops or truncates existing tables or records.
 * Run: node scripts/migrate-multi-tournament.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool(process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      database: process.env.DB_NAME || 'cricket_db',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
    });

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_multi_tournament.sql'), 'utf8');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✅ Multi-tournament migration applied. Existing matches are in Legacy Tournament.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Multi-tournament migration failed:', error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
