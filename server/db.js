/**
 * db.js — PostgreSQL pool + thin JS wrappers that call stored functions/views.
 * ALL business logic (averages, economy, best bowling, etc.) lives in schema.sql.
 */
require('dotenv').config();
const { Pool } = require('pg');

// ── Connection pool ───────────────────────────────────────────────────────────
const pool = new Pool(
  process.env.DATABASE_URL 
    ? { 
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false } // Required for most cloud providers like Render/Supabase
      }
    : {
        host    : process.env.DB_HOST     || 'localhost',
        port    : parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'cricket_db',
        user    : process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      }
);

pool.on('error', err => console.error('⚠️  DB pool error:', err.message));

// ── Active match (persist & restore across restarts) ─────────────────────────

const saveActiveMatch = (state) =>
  pool.query(
    `INSERT INTO active_match (id, state, updated_at)
     VALUES (1, $1::jsonb, NOW())
     ON CONFLICT (id) DO UPDATE
       SET state = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(state)]
  ).catch(err => console.error('saveActiveMatch:', err.message));

const loadActiveMatch = async () => {
  try {
    const res = await pool.query('SELECT state FROM active_match WHERE id = 1');
    if (res.rows.length > 0) {
      console.log('📂 Restored match state from PostgreSQL');
      return res.rows[0].state;
    }
  } catch (err) {
    console.error('loadActiveMatch:', err.message);
  }
  return null;
};

const clearActiveMatch = () =>
  pool.query('DELETE FROM active_match WHERE id = 1')
    .catch(err => console.error('clearActiveMatch:', err.message));

// ── Match archive ─────────────────────────────────────────────────────────────

const createMatchRecord = async (team1Name, team2Name, maxOvers) => {
  try {
    const res = await pool.query(
      `INSERT INTO matches (team1_name, team2_name, max_overs)
       VALUES ($1, $2, $3) RETURNING id`,
      [team1Name, team2Name, maxOvers]
    );
    return res.rows[0].id;
  } catch (err) {
    console.error('createMatchRecord:', err.message);
    return null;
  }
};

const archiveMatch = async (dbMatchId, finalState) => {
  if (!dbMatchId) return;
  const inn1 = finalState.inning1;

  // Helper: count legal balls from over arrays
  const countLegalBalls = (overHistory, currentOverBalls) => {
    const completedBalls = (overHistory || []).length * 6;
    const currentBalls = (currentOverBalls || []).filter(b => b !== 'Wd' && b !== 'Nb').length;
    return completedBalls + currentBalls;
  };

  // Calculate actual balls faced per inning
  const inning1Balls = inn1 ? countLegalBalls(inn1.overHistory, inn1.currentOverBalls) : 0;
  const inning2Balls = finalState.currentInning === 2
    ? countLegalBalls(finalState.overHistory, finalState.currentOverBalls)
    : 0;

  // Determine winner name
  let winner = null;
  let matchResultType = 'COMPLETED';
  const result = finalState.result || '';
  if (result.includes('Tied')) {
    matchResultType = 'TIE';
  } else if (result.includes(finalState.team1Name) && result.includes('won')) {
    winner = finalState.team1Name;
  } else if (result.includes(finalState.team2Name) && result.includes('won')) {
    winner = finalState.team2Name;
  }

  try {
    await pool.query(
      `UPDATE matches SET
         result            = $1,
         inning1_runs      = $2,
         inning1_wickets   = $3,
         inning2_runs      = $4,
         inning2_wickets   = $5,
         full_state        = $6::jsonb,
         winner            = $7,
         inning1_balls     = $8,
         inning2_balls     = $9,
         match_result_type = $10
       WHERE id = $11`,
      [
        finalState.result,
        inn1 ? inn1.totalRuns : 0,
        inn1 ? inn1.wickets   : 0,
        finalState.currentInning === 2 ? finalState.totalRuns : 0,
        finalState.currentInning === 2 ? finalState.wickets   : 0,
        JSON.stringify(finalState),
        winner,
        inning1Balls,
        inning2Balls,
        matchResultType,
        dbMatchId,
      ]
    );

    // ── Update Automatic Standings for P/W/L/T/NR/PTS (without touching RRD) ──
    const t1 = finalState.team1Name;
    const t2 = finalState.team2Name;

    const t1Pts = matchResultType === 'TIE' ? 1 : matchResultType === 'NO_RESULT' ? 1 : winner === t1 ? 2 : 0;
    const t2Pts = matchResultType === 'TIE' ? 1 : matchResultType === 'NO_RESULT' ? 1 : winner === t2 ? 2 : 0;

    const t1W = winner === t1 ? 1 : 0;
    const t1L = (matchResultType === 'COMPLETED' && winner !== t1) ? 1 : 0;
    const t2W = winner === t2 ? 1 : 0;
    const t2L = (matchResultType === 'COMPLETED' && winner !== t2) ? 1 : 0;

    const ties = matchResultType === 'TIE' ? 1 : 0;
    const nrs = matchResultType === 'NO_RESULT' ? 1 : 0;

    const updateStandingsQuery = `
      INSERT INTO tournament_standings (team_name, status, played, wins, losses, ties, no_results, points, rrd)
      VALUES ($1, $2, 1, $3, $4, $5, $6, $7, 0)
      ON CONFLICT (team_name, status) DO UPDATE SET
        played = tournament_standings.played + 1,
        wins = tournament_standings.wins + EXCLUDED.wins,
        losses = tournament_standings.losses + EXCLUDED.losses,
        ties = tournament_standings.ties + EXCLUDED.ties,
        no_results = tournament_standings.no_results + EXCLUDED.no_results,
        points = tournament_standings.points + EXCLUDED.points,
        updated_at = CURRENT_TIMESTAMP,
        updated_by = 'SYSTEM (Match Completed)'
    `;

    // Update both DRAFT and PUBLISHED rows for Team 1
    await pool.query(updateStandingsQuery, [t1, 'DRAFT', t1W, t1L, ties, nrs, t1Pts]);
    await pool.query(updateStandingsQuery, [t1, 'PUBLISHED', t1W, t1L, ties, nrs, t1Pts]);
    // Update both DRAFT and PUBLISHED rows for Team 2
    await pool.query(updateStandingsQuery, [t2, 'DRAFT', t2W, t2L, ties, nrs, t2Pts]);
    await pool.query(updateStandingsQuery, [t2, 'PUBLISHED', t2W, t2L, ties, nrs, t2Pts]);

  } catch (err) {
    console.error('archiveMatch:', err.message);
  }
};

// ── Ball-by-ball log ──────────────────────────────────────────────────────────

const saveBallEvent = (dbMatchId, inningNum, overNum, ballInOver, ballType, batsmanName, bowlerName, runsScored) => {
  if (!dbMatchId) return;
  pool.query(
    `INSERT INTO match_balls
       (match_id, inning_number, over_number, ball_in_over, ball_type, batsman_name, bowler_name, runs_scored)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [dbMatchId, inningNum, overNum, ballInOver, ballType, batsmanName, bowlerName, runsScored]
  ).catch(err => console.error('saveBallEvent:', err.message));
};

// ── Stored function callers ───────────────────────────────────────────────────
// These are thin JS wrappers; ALL logic is in schema.sql stored functions.

/** Increment matches_played by 1 for a player (call once per player per match) */
const recordMatchParticipation = (playerName) =>
  pool.query('SELECT record_match_participation($1)', [playerName])
    .catch(err => console.error(`record_match_participation(${playerName}):`, err.message));

/** Update batting career stats — calls upsert_batting_stats() in PostgreSQL */
const upsertBattingStats = (playerName, runs, balls, fours, sixes, isNotOut) =>
  pool.query(
    'SELECT upsert_batting_stats($1::varchar, $2::int, $3::int, $4::int, $5::int, $6::boolean)',
    [playerName, runs, balls, fours, sixes, isNotOut]
  ).catch(err => console.error(`upsert_batting_stats(${playerName}):`, err.message));

/** Update bowling career stats — calls upsert_bowling_stats() in PostgreSQL */
const upsertBowlingStats = (playerName, ballsBowled, runsConceded, wickets) =>
  pool.query(
    'SELECT upsert_bowling_stats($1::varchar, $2::int, $3::int, $4::int)',
    [playerName, ballsBowled, runsConceded, wickets]
  ).catch(err => console.error(`upsert_bowling_stats(${playerName}):`, err.message));

/** Update team win/loss record — calls upsert_team_record() in PostgreSQL */
const upsertTeamRecord = (teamName, runsScored, wicketsTaken, won, lost, tied) =>
  pool.query(
    'SELECT upsert_team_record($1::varchar, $2::int, $3::int, $4::boolean, $5::boolean, $6::boolean)',
    [teamName, runsScored, wicketsTaken, won, lost, tied]
  ).catch(err => console.error(`upsert_team_record(${teamName}):`, err.message));

/** Update points table — calls update_points_table_entry() stored function
 *  nrrBallsBatted : full quota balls if all-out, else actual balls faced
 *  nrrBallsBowled : full quota balls if opposition all-out, else actual balls bowled
 */
const updatePointsTableEntry = (
  teamName, runsScored, ballsBatted, nrrBallsBatted,
  runsConceded, ballsBowled, nrrBallsBowled,
  won, lost, tied
) =>
  pool.query(
    `SELECT update_points_table_entry(
      $1::varchar, $2::int, $3::int, $4::int,
      $5::int, $6::int, $7::int,
      $8::boolean, $9::boolean, $10::boolean)`,
    [teamName, runsScored, ballsBatted, nrrBallsBatted,
     runsConceded, ballsBowled, nrrBallsBowled,
     won, lost, tied]
  ).catch(err => console.error(`update_points_table_entry(${teamName}):`, err.message));


/** Query the points_table_view — ranking, NRR, all computed in PostgreSQL */
const getPointsTable = () => pool.query('SELECT * FROM points_table_view');

// ── View queries (analytics computed entirely in PostgreSQL) ──────────────────

const getBattingStats  = () => pool.query('SELECT * FROM batting_stats_view');
const getBowlingStats  = () => pool.query('SELECT * FROM bowling_stats_view');
const getTeamStats     = () => pool.query('SELECT * FROM team_stats_view');
const getMatchHistory  = () => pool.query('SELECT * FROM match_history_view');
const getMatchBalls    = (matchId) =>
  pool.query(
    'SELECT * FROM match_balls WHERE match_id = $1 ORDER BY inning_number, over_number, ball_in_over',
    [matchId]
  );
const getMatchFullState = (matchId) => pool.query('SELECT full_state FROM matches WHERE id = $1', [matchId]);

// ── Admin-Managed Standings ───────────────────────────────────────────────────

const getPublicStandings = async () => {
  const result = await pool.query(`
    SELECT team_name as "teamName", played, wins, losses, ties, no_results as "noResults", points, rrd
    FROM tournament_standings
    WHERE status = 'PUBLISHED'
    ORDER BY points DESC, rrd DESC
  `);
  // add position index
  result.rows.forEach((t, i) => t.position = i + 1);
  return result.rows;
};

const getAdminStandings = async () => {
  // Return draft and published data for comparison
  const draft = await pool.query("SELECT team_name, played, wins, losses, ties, no_results, points, rrd FROM tournament_standings WHERE status = 'DRAFT' ORDER BY points DESC, rrd DESC");
  const pub   = await pool.query("SELECT team_name, played, wins, losses, ties, no_results, points, rrd FROM tournament_standings WHERE status = 'PUBLISHED'");
  
  // Create a map of published values for easy diff
  const pubMap = {};
  pub.rows.forEach(r => pubMap[r.team_name] = r);

  return draft.rows.map(d => ({
    teamName: d.team_name,
    draft: { played: d.played, wins: d.wins, losses: d.losses, ties: d.ties, noResults: d.no_results, points: d.points, rrd: d.rrd },
    published: pubMap[d.team_name] ? { 
      played: pubMap[d.team_name].played, wins: pubMap[d.team_name].wins, losses: pubMap[d.team_name].losses, 
      ties: pubMap[d.team_name].ties, noResults: pubMap[d.team_name].no_results, points: pubMap[d.team_name].points, rrd: pubMap[d.team_name].rrd 
    } : null
  }));
};

const saveDraftStandings = async (standingsData, adminId) => {
  for (const t of standingsData) {
    await pool.query(`
      INSERT INTO tournament_standings (team_name, status, played, wins, losses, ties, no_results, points, rrd, updated_by, updated_at)
      VALUES ($1, 'DRAFT', $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (team_name, status) DO UPDATE SET
        played = EXCLUDED.played, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
        ties = EXCLUDED.ties, no_results = EXCLUDED.no_results, points = EXCLUDED.points,
        rrd = EXCLUDED.rrd, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    `, [
      t.teamName, t.draft.played, t.draft.wins, t.draft.losses, 
      t.draft.ties, t.draft.noResults, t.draft.points, t.draft.rrd, adminId || 'Admin'
    ]);
  }
};

const publishStandings = async (adminId) => {
  // Get all drafts
  const drafts = await pool.query("SELECT * FROM tournament_standings WHERE status = 'DRAFT'");
  for (const d of drafts.rows) {
    await pool.query(`
      INSERT INTO tournament_standings (team_name, status, played, wins, losses, ties, no_results, points, rrd, updated_by, updated_at)
      VALUES ($1, 'PUBLISHED', $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
      ON CONFLICT (team_name, status) DO UPDATE SET
        played = EXCLUDED.played, wins = EXCLUDED.wins, losses = EXCLUDED.losses,
        ties = EXCLUDED.ties, no_results = EXCLUDED.no_results, points = EXCLUDED.points,
        rrd = EXCLUDED.rrd, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
    `, [
      d.team_name, d.played, d.wins, d.losses, d.ties, d.no_results, d.points, d.rrd, adminId || 'Admin'
    ]);
  }
};

module.exports = {
  saveActiveMatch,
  loadActiveMatch,
  clearActiveMatch,
  createMatchRecord,
  archiveMatch,
  saveBallEvent,
  recordMatchParticipation,
  upsertBattingStats,
  upsertBowlingStats,
  upsertTeamRecord,
  updatePointsTableEntry: () => {}, // deprecated, kept as no-op for compatibility
  getBattingStats,
  getBowlingStats,
  getTeamStats,
  getMatchHistory,
  getMatchBalls,
  getMatchFullState,
  getPointsTable,
  getPublicStandings,
  getAdminStandings,
  saveDraftStandings,
  publishStandings,
};

