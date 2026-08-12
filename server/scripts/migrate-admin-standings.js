require('dotenv').config();
const { Pool } = require('pg');
const { getTournamentStandings } = require('../db'); // we will implement the aggregation logic directly here

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

    // 1. Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_standings (
        team_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
        played INT DEFAULT 0,
        wins INT DEFAULT 0,
        losses INT DEFAULT 0,
        ties INT DEFAULT 0,
        no_results INT DEFAULT 0,
        points INT DEFAULT 0,
        rrd NUMERIC(10, 2) DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(100),
        PRIMARY KEY (team_name, status)
      );
    `);

    // 2. Compute current standings from matches table
    const result = await client.query(
      `SELECT id, team1_name, team2_name, inning1_runs, inning1_balls,
              inning2_runs, inning2_balls, winner, match_result_type
       FROM matches
       WHERE result IS NOT NULL
         AND match_result_type IN ('COMPLETED', 'TIE')`
    );

    const matches = result.rows;
    const teams = {};

    for (const m of matches) {
      const t1 = m.team1_name;
      const t2 = m.team2_name;
      const isTie = m.match_result_type === 'TIE';

      if (!teams[t1]) teams[t1] = { played: 0, wins: 0, losses: 0, ties: 0, noResults: 0, runsScored: 0, ballsFaced: 0, runsConceded: 0, ballsBowled: 0 };
      if (!teams[t2]) teams[t2] = { played: 0, wins: 0, losses: 0, ties: 0, noResults: 0, runsScored: 0, ballsFaced: 0, runsConceded: 0, ballsBowled: 0 };

      teams[t1].played++;
      teams[t2].played++;

      if (isTie) {
        teams[t1].ties++;
        teams[t2].ties++;
      } else if (m.winner === t1) {
        teams[t1].wins++;
        teams[t2].losses++;
      } else if (m.winner === t2) {
        teams[t2].wins++;
        teams[t1].losses++;
      }

      // RRD aggregates (Validating balls to avoid skew, just like API)
      const i1Runs = m.inning1_runs || 0;
      const i1Balls = m.inning1_balls || 0;
      const i2Runs = m.inning2_runs || 0;
      const i2Balls = m.inning2_balls || 0;

      let isRRDValid = true;
      if (i1Balls === 0 || i2Balls === 0) isRRDValid = false;
      if (i1Balls === 0 && i1Runs > 0) isRRDValid = false;
      if (i2Balls === 0 && i2Runs > 0) isRRDValid = false;

      if (isRRDValid) {
        teams[t1].runsScored += i1Runs;
        teams[t1].ballsFaced += i1Balls;
        teams[t1].runsConceded += i2Runs;
        teams[t1].ballsBowled += i2Balls;

        teams[t2].runsScored += i2Runs;
        teams[t2].ballsFaced += i2Balls;
        teams[t2].runsConceded += i1Runs;
        teams[t2].ballsBowled += i1Balls;
      }
    }

    // Insert seeds
    for (const [teamName, t] of Object.entries(teams)) {
      const points = (t.wins * 2) + (t.ties * 1) + (t.noResults * 1);
      
      const runRateScored = t.ballsFaced > 0 ? (t.runsScored * 6) / t.ballsFaced : 0;
      const runRateConceded = t.ballsBowled > 0 ? (t.runsConceded * 6) / t.ballsBowled : 0;
      const rrd = Math.round((runRateScored - runRateConceded) * 100) / 100;

      await client.query(`
        INSERT INTO tournament_standings (team_name, status, played, wins, losses, ties, no_results, points, rrd)
        VALUES ($1, 'DRAFT', $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (team_name, status) DO UPDATE SET
          played = EXCLUDED.played, wins = EXCLUDED.wins, losses = EXCLUDED.losses, 
          ties = EXCLUDED.ties, no_results = EXCLUDED.no_results, points = EXCLUDED.points, rrd = EXCLUDED.rrd
      `, [teamName, t.played, t.wins, t.losses, t.ties, t.noResults, points, rrd]);

      await client.query(`
        INSERT INTO tournament_standings (team_name, status, played, wins, losses, ties, no_results, points, rrd)
        VALUES ($1, 'PUBLISHED', $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (team_name, status) DO UPDATE SET
          played = EXCLUDED.played, wins = EXCLUDED.wins, losses = EXCLUDED.losses, 
          ties = EXCLUDED.ties, no_results = EXCLUDED.no_results, points = EXCLUDED.points, rrd = EXCLUDED.rrd
      `, [teamName, t.played, t.wins, t.losses, t.ties, t.noResults, points, rrd]);
    }

    // Fetch any teams from team_stats that haven't played a match yet
    const extraTeams = await client.query('SELECT DISTINCT team_name FROM team_stats');
    for (const row of extraTeams.rows) {
      if (!teams[row.team_name]) {
        await client.query(`
          INSERT INTO tournament_standings (team_name, status) VALUES ($1, 'DRAFT') ON CONFLICT DO NOTHING
        `, [row.team_name]);
        await client.query(`
          INSERT INTO tournament_standings (team_name, status) VALUES ($1, 'PUBLISHED') ON CONFLICT DO NOTHING
        `, [row.team_name]);
      }
    }

    await client.query('COMMIT');
    console.log('✅ Migrated and seeded tournament_standings table.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', e);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
