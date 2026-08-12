require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function clearDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log('🧹 Clearing test data from all tables...');
    
    // TRUNCATE all tables and restart sequences to reset IDs to 1
    await client.query(`
      TRUNCATE TABLE 
        active_match, 
        matches, 
        player_stats, 
        team_stats, 
        match_balls, 
        points_table 
      RESTART IDENTITY CASCADE;
    `);

    // Insert the initial active_match state since the app expects at least 1 row
    await client.query(`
      INSERT INTO active_match (id, state) 
      VALUES (1, '{"status": "not_started"}')
      ON CONFLICT (id) DO UPDATE SET state = '{"status": "not_started"}';
    `);

    await client.query('COMMIT');
    console.log('✅ Database cleared successfully. All sequences reset.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error clearing database:', err);
  } finally {
    client.release();
    pool.end();
  }
}

clearDb();
