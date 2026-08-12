/**
 * backfill-match-data.js — Backfill winner, inning1_balls, inning2_balls
 * from full_state JSONB for matches archived before the YEH-RRD migration.
 *
 * Run: node scripts/backfill-match-data.js
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

async function backfill() {
  const client = await pool.connect();
  try {
    // Find matches that have a result but missing balls data
    const res = await client.query(
      `SELECT id, full_state, result, team1_name, team2_name
       FROM matches
       WHERE result IS NOT NULL
         AND (inning1_balls IS NULL OR inning1_balls = 0)
         AND full_state IS NOT NULL`
    );

    console.log(`Found ${res.rows.length} match(es) to backfill.`);

    for (const row of res.rows) {
      const state = row.full_state;
      if (!state) continue;

      // Count legal balls from over arrays
      const countLegalBalls = (overHistory, currentOverBalls) => {
        const completedBalls = (overHistory || []).length * 6;
        const currentBalls = (currentOverBalls || []).filter(b => b !== 'Wd' && b !== 'Nb').length;
        return completedBalls + currentBalls;
      };

      const inn1 = state.inning1;
      const inning1Balls = inn1 ? countLegalBalls(inn1.overHistory, inn1.currentOverBalls) : 0;
      const inning2Balls = state.currentInning === 2
        ? countLegalBalls(state.overHistory, state.currentOverBalls)
        : 0;

      // Determine winner
      let winner = null;
      let matchResultType = 'COMPLETED';
      const result = row.result || '';
      if (result.includes('Tied')) {
        matchResultType = 'TIE';
      } else if (result.includes(row.team1_name) && result.includes('won')) {
        winner = row.team1_name;
      } else if (result.includes(row.team2_name) && result.includes('won')) {
        winner = row.team2_name;
      }

      await client.query(
        `UPDATE matches SET
           winner = $1, inning1_balls = $2, inning2_balls = $3, match_result_type = $4
         WHERE id = $5`,
        [winner, inning1Balls, inning2Balls, matchResultType, row.id]
      );

      console.log(`  ✅ Match #${row.id}: ${row.team1_name} vs ${row.team2_name} — winner=${winner}, inn1Balls=${inning1Balls}, inn2Balls=${inning2Balls}, type=${matchResultType}`);
    }

    console.log('✅ Backfill complete!');
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

backfill();
