-- Decorating and charm (docs/HOME_SCENE.md Part F, F.9; lib/decor.js).
BEGIN;

-- What the player has placed in the Home scene: benches, lantern posts,
-- flower beds, fence pieces, a well, a pond. `x` and `y` are percent of the
-- area's width and height (the foot of the thing), as buildings' are.
CREATE TABLE IF NOT EXISTS decorations (
  id            SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  area          TEXT NOT NULL DEFAULT 'town',
  x             NUMERIC(6,2) NOT NULL,
  y             NUMERIC(6,2) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_decorations_town ON decorations (settlement_id);

COMMIT;
