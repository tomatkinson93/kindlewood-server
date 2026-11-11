-- The first time each player reaches each step (lib/milestones). Idempotent.
CREATE TABLE IF NOT EXISTS player_milestones (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  reached_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_player_milestones_key ON player_milestones (key);
