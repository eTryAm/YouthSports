/**
 * migrate-points.js — Migration to support YEH-RRD dynamic points table.
 *
 * Adds winner, inning1_balls, inning2_balls columns to matches table.
 * Drops old points_table, update_points_table_entry, and points_table_view
 * which used IPL-style incremental NRR logic.
 *
 * Run: node scripts/migrate-points.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host    : process.env.DB_HOST     || 'localhost',
  port    : parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'cricket_db',
  user    : process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('Adding new columns to matches table...');
    // Add columns if they don't exist (safe to re-run)
    await client.query(`
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS winner VARCHAR(100);
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS inning1_balls INT DEFAULT 0;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS inning2_balls INT DEFAULT 0;
      ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_result_type VARCHAR(20) DEFAULT 'COMPLETED';
    `);

    console.log('Dropping old IPL-style NRR objects...');
    // Drop old view first (depends on old table)
    await client.query('DROP VIEW IF EXISTS points_table_view CASCADE;');
    // Drop old stored function
    await client.query(`DROP FUNCTION IF EXISTS update_points_table_entry(VARCHAR, INT, INT, INT, INT, INT, INT, BOOLEAN, BOOLEAN, BOOLEAN) CASCADE;`);
    // Drop old table
    await client.query('DROP TABLE IF EXISTS points_table CASCADE;');

    await client.query('COMMIT');
    console.log('✅ Migration complete! YEH-RRD schema is ready.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
