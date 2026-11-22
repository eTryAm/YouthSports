-- Multi-tournament foundation. This migration is additive and safe to re-run.
-- Existing archived matches are assigned to the Legacy Tournament below.

CREATE TABLE IF NOT EXISTS tournaments (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(180) NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  banner_url TEXT,
  start_date DATE,
  end_date DATE,
  venues JSONB NOT NULL DEFAULT '[]'::jsonb,
  format VARCHAR(32) NOT NULL DEFAULT 'ROUND_ROBIN'
    CHECK (format IN ('ROUND_ROBIN', 'KNOCKOUT', 'LEAGUE_PLAYOFFS', 'GROUP_KNOCKOUT')),
  status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'UPCOMING', 'REGISTRATION_OPEN', 'ONGOING', 'COMPLETED', 'ARCHIVED')),
  overs_per_innings SMALLINT NOT NULL DEFAULT 20 CHECK (overs_per_innings > 0),
  points_for_win SMALLINT NOT NULL DEFAULT 2,
  points_for_loss SMALLINT NOT NULL DEFAULT 0,
  points_for_tie SMALLINT NOT NULL DEFAULT 1,
  points_for_no_result SMALLINT NOT NULL DEFAULT 1,
  qualification_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  playing_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_published BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS teams (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL UNIQUE,
  slug VARCHAR(140) NOT NULL UNIQUE,
  abbreviation VARCHAR(10),
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(140) NOT NULL,
  slug VARCHAR(160) NOT NULL UNIQUE,
  photo_url TEXT,
  date_of_birth DATE,
  batting_style VARCHAR(40),
  bowling_style VARCHAR(60),
  playing_role VARCHAR(20) CHECK (playing_role IN ('BATTER', 'BOWLER', 'ALL_ROUNDER', 'WICKETKEEPER')),
  bio TEXT NOT NULL DEFAULT '',
  admin_contact JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_teams (
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id BIGINT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
  seed SMALLINT,
  group_code VARCHAR(20),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, team_id)
);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  jersey_number VARCHAR(10),
  is_captain BOOLEAN NOT NULL DEFAULT FALSE,
  eligibility_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (eligibility_status IN ('ACTIVE', 'INACTIVE', 'INELIGIBLE', 'WITHDRAWN')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, player_id),
  FOREIGN KEY (tournament_id, team_id) REFERENCES tournament_teams(tournament_id, team_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS tournament_stages (
  id BIGSERIAL PRIMARY KEY,
  tournament_id BIGINT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  stage_type VARCHAR(24) NOT NULL DEFAULT 'LEAGUE'
    CHECK (stage_type IN ('LEAGUE', 'GROUP', 'KNOCKOUT', 'PLAYOFF')),
  display_order SMALLINT NOT NULL DEFAULT 0,
  qualification_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS tournament_groups (
  id BIGSERIAL PRIMARY KEY,
  stage_id BIGINT NOT NULL REFERENCES tournament_stages(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  UNIQUE (stage_id, name)
);

CREATE TABLE IF NOT EXISTS tournament_group_teams (
  group_id BIGINT NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
  tournament_id BIGINT NOT NULL,
  team_id BIGINT NOT NULL,
  PRIMARY KEY (group_id, team_id),
  FOREIGN KEY (tournament_id, team_id) REFERENCES tournament_teams(tournament_id, team_id) ON DELETE CASCADE
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS tournament_id BIGINT REFERENCES tournaments(id) ON DELETE RESTRICT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stage_id BIGINT REFERENCES tournament_stages(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS group_id BIGINT REFERENCES tournament_groups(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team1_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team2_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_number VARCHAR(30);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS venue VARCHAR(160);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'DRAFT'
  CHECK (status IN ('DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETED', 'POSTPONED', 'ABANDONED', 'CANCELLED'));
ALTER TABLE matches ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS toss_winner_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS toss_decision VARCHAR(10) CHECK (toss_decision IN ('BAT', 'BOWL'));

CREATE TABLE IF NOT EXISTS match_officials (
  id BIGSERIAL PRIMARY KEY,
  match_id INT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  name VARCHAR(140) NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('UMPIRE', 'REFEREE', 'SCORER', 'OTHER'))
);

CREATE TABLE IF NOT EXISTS innings (
  id BIGSERIAL PRIMARY KEY,
  match_id INT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  innings_number SMALLINT NOT NULL CHECK (innings_number > 0),
  batting_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  bowling_team_id BIGINT REFERENCES teams(id) ON DELETE SET NULL,
  runs INT NOT NULL DEFAULT 0 CHECK (runs >= 0),
  wickets SMALLINT NOT NULL DEFAULT 0 CHECK (wickets >= 0),
  legal_balls INT NOT NULL DEFAULT 0 CHECK (legal_balls >= 0),
  extras JSONB NOT NULL DEFAULT '{"byes": 0, "legByes": 0, "wides": 0, "noBalls": 0, "penalty": 0}'::jsonb,
  target INT,
  scoring_mode VARCHAR(20) NOT NULL DEFAULT 'BALL_BY_BALL'
    CHECK (scoring_mode IN ('BALL_BY_BALL', 'MANUAL')),
  UNIQUE (match_id, innings_number)
);

CREATE TABLE IF NOT EXISTS deliveries (
  id BIGSERIAL PRIMARY KEY,
  innings_id BIGINT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  sequence_number INT NOT NULL CHECK (sequence_number > 0),
  over_number SMALLINT NOT NULL CHECK (over_number >= 0),
  ball_in_over SMALLINT NOT NULL CHECK (ball_in_over BETWEEN 1 AND 6),
  striker_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  bowler_player_id BIGINT REFERENCES players(id) ON DELETE SET NULL,
  batter_runs SMALLINT NOT NULL DEFAULT 0 CHECK (batter_runs >= 0),
  extra_runs SMALLINT NOT NULL DEFAULT 0 CHECK (extra_runs >= 0),
  extras JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_legal BOOLEAN NOT NULL DEFAULT TRUE,
  wicket JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (innings_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_id BIGINT,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(80) NOT NULL,
  action VARCHAR(50) NOT NULL,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_tournament_status ON matches(tournament_id, status, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS idx_tournament_teams_team ON tournament_teams(team_id, tournament_id);
CREATE INDEX IF NOT EXISTS idx_tournament_players_team ON tournament_players(tournament_id, team_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_innings_sequence ON deliveries(innings_id, sequence_number);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at DESC);

-- Preserve all historic matches without claiming they belong to a newly-created event.
INSERT INTO tournaments (name, slug, description, format, status, overs_per_innings, is_published)
VALUES ('Legacy Tournament', 'legacy-tournament', 'Matches imported from the pre-tournament platform.', 'ROUND_ROBIN', 'COMPLETED', 20, TRUE)
ON CONFLICT (slug) DO NOTHING;

UPDATE matches
SET tournament_id = (SELECT id FROM tournaments WHERE slug = 'legacy-tournament')
WHERE tournament_id IS NULL;

UPDATE matches
SET status = CASE
  WHEN result IS NOT NULL THEN 'COMPLETED'
  ELSE 'DRAFT'
END
WHERE status = 'DRAFT';
