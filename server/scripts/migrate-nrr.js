/**
 * migrate-nrr.js — One-time migration to add IPL-standard NRR columns
 * Run: node migrate-nrr.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host     : process.env.DB_HOST,
  port     : process.env.DB_PORT,
  database : process.env.DB_NAME,
  user     : process.env.DB_USER,
  password : process.env.DB_PASSWORD,
});

async function migrate() {
  try {
    // 1. Add new NRR columns if they don't exist
    await pool.query('ALTER TABLE points_table ADD COLUMN IF NOT EXISTS nrr_balls_batted INT DEFAULT 0');
    await pool.query('ALTER TABLE points_table ADD COLUMN IF NOT EXISTS nrr_balls_bowled INT DEFAULT 0');
    console.log('✅ Columns added (or already existed)');

    // 2. Backfill existing rows — copy actual balls to NRR fields as an approximation
    await pool.query(`
      UPDATE points_table
      SET nrr_balls_batted = total_balls_batted,
          nrr_balls_bowled = total_balls_bowled
      WHERE nrr_balls_batted = 0 AND total_balls_batted > 0
    `);
    console.log('✅ Existing rows backfilled');

    // 3. Recreate stored function with new signature
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_points_table_entry(
        p_team_name         VARCHAR,
        p_runs_scored       INT,
        p_balls_batted      INT,
        p_nrr_balls_batted  INT,
        p_runs_conceded     INT,
        p_balls_bowled      INT,
        p_nrr_balls_bowled  INT,
        p_won               BOOLEAN,
        p_lost              BOOLEAN,
        p_tied              BOOLEAN
      ) RETURNS VOID AS $func$
      DECLARE
        v_pts INT := CASE
          WHEN p_won  THEN 2
          WHEN p_tied THEN 1
          ELSE 0
        END;
      BEGIN
        INSERT INTO points_table (
          team_name, matches_played,
          matches_won, matches_lost, matches_tied,
          points,
          total_runs_scored, total_balls_batted,
          total_runs_conceded, total_balls_bowled,
          nrr_balls_batted, nrr_balls_bowled
        )
        VALUES (
          p_team_name, 1,
          CASE WHEN p_won  THEN 1 ELSE 0 END,
          CASE WHEN p_lost THEN 1 ELSE 0 END,
          CASE WHEN p_tied THEN 1 ELSE 0 END,
          v_pts,
          p_runs_scored, p_balls_batted,
          p_runs_conceded, p_balls_bowled,
          p_nrr_balls_batted, p_nrr_balls_bowled
        )
        ON CONFLICT (team_name) DO UPDATE SET
          matches_played      = points_table.matches_played      + 1,
          matches_won         = points_table.matches_won         + CASE WHEN p_won  THEN 1 ELSE 0 END,
          matches_lost        = points_table.matches_lost        + CASE WHEN p_lost THEN 1 ELSE 0 END,
          matches_tied        = points_table.matches_tied        + CASE WHEN p_tied THEN 1 ELSE 0 END,
          points              = points_table.points              + v_pts,
          total_runs_scored   = points_table.total_runs_scored   + p_runs_scored,
          total_balls_batted  = points_table.total_balls_batted  + p_balls_batted,
          total_runs_conceded = points_table.total_runs_conceded + p_runs_conceded,
          total_balls_bowled  = points_table.total_balls_bowled  + p_balls_bowled,
          nrr_balls_batted    = points_table.nrr_balls_batted    + p_nrr_balls_batted,
          nrr_balls_bowled    = points_table.nrr_balls_bowled    + p_nrr_balls_bowled,
          updated_at          = NOW();
      END;
      $func$ LANGUAGE plpgsql
    `);
    console.log('✅ Stored function recreated');

    // 4. Drop old view (column list changed) and create new one
    await pool.query('DROP VIEW IF EXISTS points_table_view');
    await pool.query(`
      CREATE VIEW points_table_view AS
      SELECT
        ROW_NUMBER() OVER (
          ORDER BY
            points DESC,
            CASE
              WHEN nrr_balls_batted > 0 AND nrr_balls_bowled > 0
              THEN (total_runs_scored::NUMERIC / nrr_balls_batted * 6)
                 - (total_runs_conceded::NUMERIC / nrr_balls_bowled * 6)
              ELSE 0
            END DESC,
            matches_won DESC
        ) AS position,
        team_name,
        matches_played  AS p,
        matches_won     AS w,
        matches_lost    AS l,
        matches_tied    AS t,
        no_result       AS nr,
        points          AS pts,
        CASE
          WHEN nrr_balls_batted > 0 AND nrr_balls_bowled > 0
          THEN ROUND(
                 (total_runs_scored::NUMERIC   / nrr_balls_batted  * 6)
               - (total_runs_conceded::NUMERIC / nrr_balls_bowled  * 6),
               3)
          ELSE 0::NUMERIC
        END AS nrr,
        updated_at
      FROM points_table
      ORDER BY
        points DESC,
        CASE
          WHEN nrr_balls_batted > 0 AND nrr_balls_bowled > 0
          THEN (total_runs_scored::NUMERIC / nrr_balls_batted * 6)
             - (total_runs_conceded::NUMERIC / nrr_balls_bowled * 6)
          ELSE 0
        END DESC
    `);
    console.log('✅ View recreated (IPL NRR standard)');

    await pool.end();
    console.log('\n🏆 Migration complete! NRR is now ICC/IPL standard.');
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    await pool.end();
    process.exit(1);
  }
}

migrate();
