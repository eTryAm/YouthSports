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
        ssl: { rejectUnauthorized: false },
        // Force IPv4 — Render free tier cannot reach Supabase via IPv6
        connectionTimeoutMillis: 10000,
      }
    : {
        host    : process.env.DB_HOST     || 'localhost',
        port    : parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || 'cricket_db',
        user    : process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
      }
);

// Force Node.js to prefer IPv4 over IPv6 (fixes Render + Supabase ENETUNREACH)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

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

const createMatchRecord = async (team1Name, team2Name, maxOvers, tournamentId = null) => {
  try {
    const res = await pool.query(
      `INSERT INTO matches (team1_name, team2_name, max_overs, tournament_id)
       VALUES ($1, $2, $3, COALESCE($4, (SELECT id FROM tournaments WHERE slug = 'legacy-tournament')))
       RETURNING id`,
      [team1Name, team2Name, maxOvers, tournamentId]
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
    const currentBalls = (currentOverBalls || []).filter(b => !String(b).startsWith('Wd') && !String(b).startsWith('Nb')).length;
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
         match_result_type = $10,
         status            = 'COMPLETED'
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

// ── Multi-tournament foundation ────────────────────────────────────────────
// Parameterized SQL keeps all new records isolated by tournament while the
// legacy aggregate statistics remain available to existing screens.
const listTournaments = async ({ publishedOnly = false } = {}) => {
  const result = await pool.query(
    `SELECT t.id, t.name, t.slug, t.description, t.logo_url AS "logoUrl",
            t.banner_url AS "bannerUrl", t.start_date AS "startDate", t.end_date AS "endDate",
            t.venues, t.format, t.status, t.overs_per_innings AS "oversPerInnings",
            t.is_published AS "isPublished", t.created_at AS "createdAt",
            COUNT(DISTINCT tt.team_id)::int AS "teamCount", COUNT(DISTINCT m.id)::int AS "matchCount"
       FROM tournaments t
       LEFT JOIN tournament_teams tt ON tt.tournament_id = t.id
       LEFT JOIN matches m ON m.tournament_id = t.id
      WHERE ($1::boolean = FALSE OR t.is_published = TRUE)
      GROUP BY t.id
      ORDER BY t.start_date DESC NULLS LAST, t.created_at DESC`,
    [publishedOnly]
  );
  return result.rows;
};

const getTournamentBySlug = async (slug, { publishedOnly = false } = {}) => {
  const result = await pool.query(
    `SELECT t.id, t.name, t.slug, t.description, t.logo_url AS "logoUrl",
            t.banner_url AS "bannerUrl", t.start_date AS "startDate", t.end_date AS "endDate",
            t.venues, t.format, t.status, t.overs_per_innings AS "oversPerInnings",
            t.points_for_win AS "pointsForWin", t.points_for_loss AS "pointsForLoss",
            t.points_for_tie AS "pointsForTie", t.points_for_no_result AS "pointsForNoResult",
            t.qualification_rules AS "qualificationRules", t.playing_rules AS "playingRules",
            t.is_published AS "isPublished"
       FROM tournaments t
      WHERE t.slug = $1 AND ($2::boolean = FALSE OR t.is_published = TRUE)`,
    [slug, publishedOnly]
  );
  return result.rows[0] || null;
};

const createTournament = async (tournament) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `INSERT INTO tournaments (
         name, slug, description, start_date, end_date, venues, format, status,
         overs_per_innings, points_for_win, points_for_loss, points_for_tie,
         points_for_no_result, qualification_rules, playing_rules, is_published
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16)
       RETURNING id, name, slug, status, is_published AS "isPublished"`,
      [
        tournament.name, tournament.slug, tournament.description || '', tournament.startDate || null,
        tournament.endDate || null, JSON.stringify(tournament.venues || []), tournament.format,
        tournament.status, tournament.oversPerInnings, tournament.pointsForWin,
        tournament.pointsForLoss, tournament.pointsForTie, tournament.pointsForNoResult,
        JSON.stringify(tournament.qualificationRules || {}), JSON.stringify(tournament.playingRules || {}),
        Boolean(tournament.isPublished),
      ]
    );
    await client.query(
      `INSERT INTO audit_logs (entity_type, entity_id, action, after_state)
       VALUES ('TOURNAMENT', $1, 'CREATED', $2::jsonb)`,
      [String(result.rows[0].id), JSON.stringify(result.rows[0])]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const updateTournament = async (id, tournament) => {
  const result = await pool.query(
    `UPDATE tournaments SET
       name = $2, description = $3, start_date = $4, end_date = $5, venues = $6::jsonb,
       format = $7, status = $8, overs_per_innings = $9, points_for_win = $10,
       points_for_loss = $11, points_for_tie = $12, points_for_no_result = $13,
       qualification_rules = $14::jsonb, playing_rules = $15::jsonb, is_published = $16,
       updated_at = NOW()
      WHERE id = $1
      RETURNING id, name, slug, status, is_published AS "isPublished"`,
    [
      id, tournament.name, tournament.description || '', tournament.startDate || null,
      tournament.endDate || null, JSON.stringify(tournament.venues || []), tournament.format,
      tournament.status, tournament.oversPerInnings, tournament.pointsForWin,
      tournament.pointsForLoss, tournament.pointsForTie, tournament.pointsForNoResult,
      JSON.stringify(tournament.qualificationRules || {}), JSON.stringify(tournament.playingRules || {}),
      Boolean(tournament.isPublished),
    ]
  );
  return result.rows[0] || null;
};

const getTournamentDirectory = async (tournamentId) => {
  const [teams, players] = await Promise.all([
    pool.query(
      `SELECT tm.id, tm.name, tm.slug, tm.abbreviation, tm.logo_url AS "logoUrl", tt.seed, tt.group_code AS "groupCode"
         FROM tournament_teams tt JOIN teams tm ON tm.id = tt.team_id
        WHERE tt.tournament_id = $1 ORDER BY tm.name`,
      [tournamentId]
    ),
    pool.query(
      `SELECT p.id, p.full_name AS "fullName", p.slug, p.playing_role AS "playingRole",
              p.batting_style AS "battingStyle", p.bowling_style AS "bowlingStyle", tp.team_id AS "teamId",
              tp.jersey_number AS "jerseyNumber", tp.is_captain AS "isCaptain", tp.eligibility_status AS "eligibilityStatus"
         FROM tournament_players tp JOIN players p ON p.id = tp.player_id
        WHERE tp.tournament_id = $1 ORDER BY p.full_name`,
      [tournamentId]
    ),
  ]);
  return { teams: teams.rows, players: players.rows };
};

const listTeams = async () => {
  const result = await pool.query(
    `SELECT id, name, slug, abbreviation, description, logo_url AS "logoUrl"
       FROM teams ORDER BY name`
  );
  return result.rows;
};

const createTeam = async (team) => {
  const result = await pool.query(
    `INSERT INTO teams (name, slug, abbreviation, description, logo_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, slug, abbreviation, description, logo_url AS "logoUrl"`,
    [team.name, team.slug, team.abbreviation || null, team.description || '', team.logoUrl || null]
  );
  return result.rows[0];
};

const listPlayers = async () => {
  const result = await pool.query(
    `SELECT id, full_name AS "fullName", slug, playing_role AS "playingRole",
            batting_style AS "battingStyle", bowling_style AS "bowlingStyle", photo_url AS "photoUrl"
       FROM players ORDER BY full_name`
  );
  return result.rows;
};

const createPlayer = async (player) => {
  const result = await pool.query(
    `INSERT INTO players (full_name, slug, photo_url, date_of_birth, batting_style, bowling_style, playing_role, bio)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, full_name AS "fullName", slug, playing_role AS "playingRole"`,
    [player.fullName, player.slug, player.photoUrl || null, player.dateOfBirth || null,
      player.battingStyle || null, player.bowlingStyle || null, player.playingRole || null, player.bio || '']
  );
  return result.rows[0];
};

const registerTournamentTeam = async (tournamentId, teamId, registration) => {
  const result = await pool.query(
    `INSERT INTO tournament_teams (tournament_id, team_id, seed, group_code)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tournament_id, team_id) DO UPDATE SET seed = EXCLUDED.seed, group_code = EXCLUDED.group_code
     RETURNING tournament_id AS "tournamentId", team_id AS "teamId", seed, group_code AS "groupCode"`,
    [tournamentId, teamId, registration.seed || null, registration.groupCode || null]
  );
  return result.rows[0];
};

const registerTournamentPlayer = async (tournamentId, playerId, registration) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (registration.teamId) {
      const registered = await client.query(
        'SELECT 1 FROM tournament_teams WHERE tournament_id = $1 AND team_id = $2', [tournamentId, registration.teamId]
      );
      if (!registered.rows.length) throw new Error('Register the player’s team in this tournament first.');
    }
    const result = await client.query(
      `INSERT INTO tournament_players (tournament_id, player_id, team_id, jersey_number, is_captain, eligibility_status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tournament_id, player_id) DO UPDATE SET
         team_id = EXCLUDED.team_id, jersey_number = EXCLUDED.jersey_number,
         is_captain = EXCLUDED.is_captain, eligibility_status = EXCLUDED.eligibility_status
       RETURNING tournament_id AS "tournamentId", player_id AS "playerId", team_id AS "teamId"`,
      [tournamentId, playerId, registration.teamId || null, registration.jerseyNumber || null,
        Boolean(registration.isCaptain), registration.eligibilityStatus || 'ACTIVE']
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};

const listTournamentFixtures = async (tournamentId, { publishedOnly = false } = {}) => {
  const result = await pool.query(
    `SELECT m.id, m.match_number AS "matchNumber", m.scheduled_at AS "scheduledAt", m.venue, m.status,
            m.is_published AS "isPublished", m.result, home.name AS "team1Name", away.name AS "team2Name"
       FROM matches m
       LEFT JOIN teams home ON home.id = m.team1_id
       LEFT JOIN teams away ON away.id = m.team2_id
      WHERE m.tournament_id = $1 AND ($2::boolean = FALSE OR m.is_published = TRUE)
      ORDER BY m.scheduled_at NULLS LAST, m.id`,
    [tournamentId, publishedOnly]
  );
  return result.rows;
};

const createFixture = async (fixture) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const teams = await client.query(
      `SELECT tt.team_id, t.name FROM tournament_teams tt JOIN teams t ON t.id = tt.team_id
        WHERE tt.tournament_id = $1 AND tt.team_id = ANY($2::bigint[])`,
      [fixture.tournamentId, [fixture.team1Id, fixture.team2Id]]
    );
    if (teams.rows.length !== 2) throw new Error('Both fixture teams must be registered in this tournament.');
    const names = Object.fromEntries(teams.rows.map((team) => [team.team_id, team.name]));
    const result = await client.query(
      `INSERT INTO matches (
         tournament_id, team1_id, team2_id, team1_name, team2_name, max_overs, match_number,
         venue, scheduled_at, status, is_published
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SCHEDULED', $10)
       RETURNING id, tournament_id AS "tournamentId", status`,
      [fixture.tournamentId, fixture.team1Id, fixture.team2Id, names[fixture.team1Id], names[fixture.team2Id],
        fixture.maxOvers, fixture.matchNumber || null, fixture.venue || null, fixture.scheduledAt || null, Boolean(fixture.isPublished)]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
};

const getFixtureForScoring = async (matchId) => {
  const fixture = await pool.query(
    `SELECT m.id, m.tournament_id AS "tournamentId", m.team1_id AS "team1Id", m.team2_id AS "team2Id",
            m.team1_name AS "team1Name", m.team2_name AS "team2Name", m.max_overs AS "maxOvers",
            m.status, t.status AS "tournamentStatus"
       FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE m.id = $1`, [matchId]
  );
  if (!fixture.rows[0]) return null;
  const data = fixture.rows[0];
  if (!['DRAFT', 'SCHEDULED'].includes(data.status)) throw new Error('Only draft or scheduled fixtures can enter live scoring.');
  if (!['UPCOMING', 'ONGOING'].includes(data.tournamentStatus)) throw new Error('The tournament must be upcoming or ongoing before a fixture can be scored.');
  const registrations = await pool.query(
    `SELECT tp.team_id AS "teamId", p.id, p.full_name AS name
       FROM tournament_players tp JOIN players p ON p.id = tp.player_id
      WHERE tp.tournament_id = $1 AND tp.eligibility_status = 'ACTIVE'
        AND tp.team_id = ANY($2::bigint[]) ORDER BY p.full_name`,
    [data.tournamentId, [data.team1Id, data.team2Id]]
  );
  const team1Players = registrations.rows.filter((player) => Number(player.teamId) === Number(data.team1Id));
  const team2Players = registrations.rows.filter((player) => Number(player.teamId) === Number(data.team2Id));
  if (team1Players.length < 2 || team2Players.length < 1) throw new Error('Both teams need active tournament registrations before scoring can begin.');
  return { ...data, team1Players, team2Players };
};

const markFixtureLive = async (matchId) => {
  await pool.query(`UPDATE matches SET status = 'LIVE' WHERE id = $1 AND status IN ('DRAFT', 'SCHEDULED')`, [matchId]);
};

module.exports = {
  saveActiveMatch,
  loadActiveMatch,
  clearActiveMatch,
  createMatchRecord,
  listTournaments,
  getTournamentBySlug,
  createTournament,
  updateTournament,
  getTournamentDirectory,
  listTeams,
  createTeam,
  listPlayers,
  createPlayer,
  registerTournamentTeam,
  registerTournamentPlayer,
  listTournamentFixtures,
  createFixture,
  getFixtureForScoring,
  markFixtureLive,
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

