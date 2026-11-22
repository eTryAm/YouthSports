-- Standardized scorecard detail records for both manual and ball-by-ball innings.
-- Additive, idempotent, and intentionally independent from legacy JSON state.

CREATE TABLE IF NOT EXISTS batting_scores (
  id BIGSERIAL PRIMARY KEY,
  innings_id BIGINT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  player_name VARCHAR(140) NOT NULL,
  batting_position SMALLINT,
  runs INT NOT NULL DEFAULT 0 CHECK (runs >= 0),
  balls INT,
  fours INT,
  sixes INT,
  dismissal JSONB,
  is_not_out BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (innings_id, player_name)
);

CREATE TABLE IF NOT EXISTS bowling_figures (
  id BIGSERIAL PRIMARY KEY,
  innings_id BIGINT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  player_name VARCHAR(140) NOT NULL,
  legal_balls INT,
  maidens INT,
  runs_conceded INT NOT NULL DEFAULT 0 CHECK (runs_conceded >= 0),
  wickets INT NOT NULL DEFAULT 0 CHECK (wickets >= 0),
  wides INT,
  no_balls INT,
  UNIQUE (innings_id, player_name)
);

CREATE TABLE IF NOT EXISTS fall_of_wickets (
  id BIGSERIAL PRIMARY KEY,
  innings_id BIGINT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  wicket_number SMALLINT NOT NULL,
  score INT NOT NULL,
  legal_balls INT,
  player_name VARCHAR(140) NOT NULL,
  UNIQUE (innings_id, wicket_number)
);

CREATE TABLE IF NOT EXISTS partnerships (
  id BIGSERIAL PRIMARY KEY,
  innings_id BIGINT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  wicket_number SMALLINT,
  batter_one_name VARCHAR(140),
  batter_two_name VARCHAR(140),
  runs INT NOT NULL DEFAULT 0,
  legal_balls INT
);

CREATE INDEX IF NOT EXISTS idx_innings_match_number ON innings(match_id, innings_number);
CREATE INDEX IF NOT EXISTS idx_batting_scores_player ON batting_scores(player_id);
CREATE INDEX IF NOT EXISTS idx_bowling_figures_player ON bowling_figures(player_id);
