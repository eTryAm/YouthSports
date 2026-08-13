-- =============================================================================
-- CRICKET LIVE — Complete PostgreSQL Schema
-- Run via: node init-db.js
-- =============================================================================

-- ── TABLES ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active_match (
  id         INT PRIMARY KEY DEFAULT 1,
  state      JSONB        NOT NULL,
  updated_at TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS matches (
  id              SERIAL PRIMARY KEY,
  team1_name      VARCHAR(100) NOT NULL,
  team2_name      VARCHAR(100) NOT NULL,
  max_overs       INT          DEFAULT 0,
  result          TEXT,
  inning1_runs    INT          DEFAULT 0,
  inning1_wickets INT          DEFAULT 0,
  inning1_balls   INT          DEFAULT 0,
  inning2_runs    INT          DEFAULT 0,
  inning2_wickets INT          DEFAULT 0,
  inning2_balls   INT          DEFAULT 0,
  full_state      JSONB,
  winner          VARCHAR(100),
  match_result_type VARCHAR(20) DEFAULT 'COMPLETED',
  match_date      DATE         DEFAULT CURRENT_DATE,
  created_at      TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS player_stats (
  id                   SERIAL PRIMARY KEY,
  player_name          VARCHAR(100) UNIQUE NOT NULL,
  matches_played       INT DEFAULT 0,
  -- Batting
  total_runs           INT DEFAULT 0,
  total_balls_faced    INT DEFAULT 0,
  total_fours          INT DEFAULT 0,
  total_sixes          INT DEFAULT 0,
  highest_score        INT DEFAULT 0,
  centuries            INT DEFAULT 0,
  half_centuries       INT DEFAULT 0,
  not_outs             INT DEFAULT 0,
  -- Bowling
  total_wickets        INT DEFAULT 0,
  total_balls_bowled   INT DEFAULT 0,
  total_runs_conceded  INT DEFAULT 0,
  five_wicket_hauls    INT DEFAULT 0,
  best_bowling_wickets INT DEFAULT 0,
  best_bowling_runs    INT DEFAULT 9999,
  updated_at           TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_stats (
  id                  SERIAL PRIMARY KEY,
  team_name           VARCHAR(100) UNIQUE NOT NULL,
  matches_played      INT DEFAULT 0,
  matches_won         INT DEFAULT 0,
  matches_lost        INT DEFAULT 0,
  matches_tied        INT DEFAULT 0,
  total_runs_scored   INT DEFAULT 0,
  total_wickets_taken INT DEFAULT 0,
  updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS match_balls (
  id            SERIAL PRIMARY KEY,
  match_id      INT REFERENCES matches(id) ON DELETE CASCADE,
  inning_number INT          NOT NULL,
  over_number   INT          NOT NULL,
  ball_in_over  INT          NOT NULL,
  ball_type     VARCHAR(10)  NOT NULL,
  batsman_name  VARCHAR(100),
  bowler_name   VARCHAR(100),
  runs_scored   INT          DEFAULT 0,
  created_at    TIMESTAMP    DEFAULT NOW()
);

-- =============================================================================
-- STORED FUNCTIONS
-- =============================================================================

-- ── Record one match appearance for a player (call once per player per match) ─
CREATE OR REPLACE FUNCTION record_match_participation(
  p_player_name VARCHAR
) RETURNS VOID AS $$
BEGIN
  INSERT INTO player_stats (player_name, matches_played)
  VALUES (p_player_name, 1)
  ON CONFLICT (player_name) DO UPDATE
    SET matches_played = player_stats.matches_played + 1,
        updated_at     = NOW();
END;
$$ LANGUAGE plpgsql;

-- ── Upsert batting stats for one player ───────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_batting_stats(
  p_player_name VARCHAR,
  p_runs        INT,
  p_balls       INT,
  p_fours       INT,
  p_sixes       INT,
  p_is_not_out  BOOLEAN
) RETURNS VOID AS $$
BEGIN
  INSERT INTO player_stats (
    player_name, matches_played,
    total_runs, total_balls_faced, total_fours, total_sixes,
    highest_score, centuries, half_centuries, not_outs
  )
  VALUES (
    p_player_name, 0,
    p_runs, p_balls, p_fours, p_sixes,
    p_runs,
    CASE WHEN p_runs >= 100            THEN 1 ELSE 0 END,
    CASE WHEN p_runs >= 50 AND p_runs < 100 THEN 1 ELSE 0 END,
    CASE WHEN p_is_not_out             THEN 1 ELSE 0 END
  )
  ON CONFLICT (player_name) DO UPDATE SET
    total_runs        = player_stats.total_runs        + p_runs,
    total_balls_faced = player_stats.total_balls_faced + p_balls,
    total_fours       = player_stats.total_fours       + p_fours,
    total_sixes       = player_stats.total_sixes       + p_sixes,
    highest_score     = GREATEST(player_stats.highest_score, p_runs),
    centuries         = player_stats.centuries         + CASE WHEN p_runs >= 100            THEN 1 ELSE 0 END,
    half_centuries    = player_stats.half_centuries    + CASE WHEN p_runs >= 50 AND p_runs < 100 THEN 1 ELSE 0 END,
    not_outs          = player_stats.not_outs          + CASE WHEN p_is_not_out             THEN 1 ELSE 0 END,
    updated_at        = NOW();
END;
$$ LANGUAGE plpgsql;

-- ── Upsert bowling stats for one player ───────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_bowling_stats(
  p_player_name   VARCHAR,
  p_balls_bowled  INT,
  p_runs_conceded INT,
  p_wickets       INT
) RETURNS VOID AS $$
BEGIN
  INSERT INTO player_stats (
    player_name, matches_played,
    total_wickets, total_balls_bowled, total_runs_conceded,
    five_wicket_hauls, best_bowling_wickets, best_bowling_runs
  )
  VALUES (
    p_player_name, 0,
    p_wickets, p_balls_bowled, p_runs_conceded,
    CASE WHEN p_wickets >= 5 THEN 1 ELSE 0 END,
    p_wickets,
    p_runs_conceded
  )
  ON CONFLICT (player_name) DO UPDATE SET
    total_wickets       = player_stats.total_wickets       + p_wickets,
    total_balls_bowled  = player_stats.total_balls_bowled  + p_balls_bowled,
    total_runs_conceded = player_stats.total_runs_conceded + p_runs_conceded,
    five_wicket_hauls   = player_stats.five_wicket_hauls   + CASE WHEN p_wickets >= 5 THEN 1 ELSE 0 END,
    -- Best bowling: higher wickets wins; on tie, fewer runs wins
    best_bowling_wickets = CASE
      WHEN p_wickets > player_stats.best_bowling_wickets
        OR (p_wickets = player_stats.best_bowling_wickets
            AND p_runs_conceded < player_stats.best_bowling_runs)
      THEN p_wickets
      ELSE player_stats.best_bowling_wickets
    END,
    best_bowling_runs = CASE
      WHEN p_wickets > player_stats.best_bowling_wickets
        OR (p_wickets = player_stats.best_bowling_wickets
            AND p_runs_conceded < player_stats.best_bowling_runs)
      THEN p_runs_conceded
      ELSE player_stats.best_bowling_runs
    END,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- ── Upsert team win/loss record ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_team_record(
  p_team_name     VARCHAR,
  p_runs_scored   INT,
  p_wickets_taken INT,
  p_won           BOOLEAN,
  p_lost          BOOLEAN,
  p_tied          BOOLEAN
) RETURNS VOID AS $$
BEGIN
  INSERT INTO team_stats (
    team_name, matches_played,
    matches_won, matches_lost, matches_tied,
    total_runs_scored, total_wickets_taken
  )
  VALUES (
    p_team_name, 1,
    CASE WHEN p_won  THEN 1 ELSE 0 END,
    CASE WHEN p_lost THEN 1 ELSE 0 END,
    CASE WHEN p_tied THEN 1 ELSE 0 END,
    p_runs_scored, p_wickets_taken
  )
  ON CONFLICT (team_name) DO UPDATE SET
    matches_played      = team_stats.matches_played      + 1,
    matches_won         = team_stats.matches_won         + CASE WHEN p_won  THEN 1 ELSE 0 END,
    matches_lost        = team_stats.matches_lost        + CASE WHEN p_lost THEN 1 ELSE 0 END,
    matches_tied        = team_stats.matches_tied        + CASE WHEN p_tied THEN 1 ELSE 0 END,
    total_runs_scored   = team_stats.total_runs_scored   + p_runs_scored,
    total_wickets_taken = team_stats.total_wickets_taken + p_wickets_taken,
    updated_at          = NOW();
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- VIEWS  (all analytics computed here in PostgreSQL, not in JS)
-- =============================================================================

-- ── Batting career stats ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW batting_stats_view AS
SELECT
  id,
  player_name,
  matches_played,
  total_runs,
  total_balls_faced,
  total_fours,
  total_sixes,
  highest_score,
  centuries,
  half_centuries,
  not_outs,
  CASE
    WHEN (matches_played - not_outs) > 0
    THEN ROUND(total_runs::NUMERIC / (matches_played - not_outs), 2)
    ELSE total_runs::NUMERIC
  END AS batting_average,
  CASE
    WHEN total_balls_faced > 0
    THEN ROUND((total_runs::NUMERIC / total_balls_faced) * 100, 2)
    ELSE 0
  END AS strike_rate
FROM player_stats
WHERE total_balls_faced > 0
ORDER BY total_runs DESC;

-- ── Bowling career stats ───────────────────────────────────────────────────────
CREATE OR REPLACE VIEW bowling_stats_view AS
SELECT
  id,
  player_name,
  matches_played,
  total_wickets,
  total_balls_bowled,
  CONCAT(
    FLOOR(total_balls_bowled / 6)::TEXT, '.',
    (total_balls_bowled % 6)::TEXT
  ) AS overs_bowled,
  total_runs_conceded,
  five_wicket_hauls,
  CONCAT(best_bowling_wickets::TEXT, '/', best_bowling_runs::TEXT) AS best_bowling,
  CASE
    WHEN total_balls_bowled > 0
    THEN ROUND((total_runs_conceded::NUMERIC / total_balls_bowled) * 6, 2)
    ELSE 0
  END AS economy,
  CASE
    WHEN total_wickets > 0
    THEN ROUND(total_runs_conceded::NUMERIC / total_wickets, 2)
    ELSE NULL
  END AS bowling_average,
  CASE
    WHEN total_wickets > 0
    THEN ROUND(total_balls_bowled::NUMERIC / total_wickets, 2)
    ELSE NULL
  END AS bowling_sr
FROM player_stats
WHERE total_balls_bowled > 0
ORDER BY total_wickets DESC, total_runs_conceded ASC;

-- ── Team standings ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW team_stats_view AS
SELECT
  id,
  team_name,
  matches_played,
  matches_won,
  matches_lost,
  matches_tied,
  total_runs_scored,
  total_wickets_taken,
  CASE
    WHEN matches_played > 0
    THEN ROUND((matches_won::NUMERIC / matches_played) * 100, 1)
    ELSE 0
  END AS win_pct
FROM team_stats
ORDER BY matches_won DESC, matches_played DESC;

-- ── match_history_view ────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW match_history_view AS
SELECT
  id,
  team1_name,
  team2_name,
  max_overs,
  result,
  inning1_runs,
  inning1_wickets,
  inning1_balls,
  inning2_runs,
  inning2_wickets,
  inning2_balls,
  winner,
  match_result_type,
  match_date,
  created_at
FROM matches
WHERE result IS NOT NULL
ORDER BY created_at DESC
LIMIT 50;

-- =============================================================================
-- POINTS TABLE
-- =============================================================================

-- ── Table ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS points_table (
  id                  SERIAL PRIMARY KEY,
  team_name           VARCHAR(100) UNIQUE NOT NULL,
  matches_played      INT     DEFAULT 0,
  matches_won         INT     DEFAULT 0,
  matches_lost        INT     DEFAULT 0,
  matches_tied        INT     DEFAULT 0,
  no_result           INT     DEFAULT 0,
  points              INT     DEFAULT 0,
  -- Actual runs/balls (for reference only)
  total_runs_scored   INT     DEFAULT 0,
  total_balls_batted  INT     DEFAULT 0,
  total_runs_conceded INT     DEFAULT 0,
  total_balls_bowled  INT     DEFAULT 0,
  -- NRR-specific denominators (ICC/IPL standard:
  --   if team is all-out → use full quota overs;
  --   if innings completed normally / chasing team won → use actual overs)
  nrr_balls_batted    INT     DEFAULT 0,  -- denominator for "runs scored per over"
  nrr_balls_bowled    INT     DEFAULT 0,  -- denominator for "runs conceded per over"
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- ── Stored function — upsert one team's record for a match ────────────────────
-- p_nrr_balls_batted  : If batting team was all-out → pass max_overs*6;
--                       otherwise pass actual legal balls faced.
-- p_nrr_balls_bowled  : If bowling team bowled opposition all-out → pass max_overs*6;
--                       otherwise pass actual legal balls bowled.
CREATE OR REPLACE FUNCTION update_points_table_entry(
  p_team_name         VARCHAR,
  p_runs_scored       INT,
  p_balls_batted      INT,    -- actual balls batted (for record)
  p_nrr_balls_batted  INT,    -- NRR denominator (quota if all-out)
  p_runs_conceded     INT,
  p_balls_bowled      INT,    -- actual balls bowled (for record)
  p_nrr_balls_bowled  INT,    -- NRR denominator (quota if opposition all-out)
  p_won               BOOLEAN,
  p_lost              BOOLEAN,
  p_tied              BOOLEAN
) RETURNS VOID AS $$
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
$$ LANGUAGE plpgsql;

-- ── View — IPL/ICC standard NRR ranking ──────────────────────────────────────
-- NRR = (Team's total runs scored / Total NRR overs faced)
--       - (Total runs scored against them / Total NRR overs bowled)
-- "NRR overs" uses the full quota if a team was all-out, actual overs otherwise.
CREATE OR REPLACE VIEW points_table_view AS
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
  matches_played      AS p,
  matches_won         AS w,
  matches_lost        AS l,
  matches_tied        AS t,
  no_result           AS nr,
  points              AS pts,
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
  END DESC;

-- =============================================================================
-- ADMIN-MANAGED TOURNAMENT STANDINGS
-- =============================================================================

CREATE TABLE IF NOT EXISTS tournament_standings (
  id          SERIAL PRIMARY KEY,
  team_name   VARCHAR(100) NOT NULL,
  status      VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',  -- 'DRAFT' or 'PUBLISHED'
  played      INT DEFAULT 0,
  wins        INT DEFAULT 0,
  losses      INT DEFAULT 0,
  ties        INT DEFAULT 0,
  no_results  INT DEFAULT 0,
  points      INT DEFAULT 0,
  rrd         NUMERIC(8,2) DEFAULT 0.00,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by  VARCHAR(100) DEFAULT 'SYSTEM',
  UNIQUE(team_name, status)
);
