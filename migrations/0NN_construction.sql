-- Building time with builders (docs/HOME_SCENE.md Part D; lib/construction.js).
BEGIN;

-- A construction site: a building, an upgrade or a house that has been paid
-- for and is being built. Builders work on the first open site in the queue.
CREATE TABLE IF NOT EXISTS construction_sites (
  id               SERIAL PRIMARY KEY,
  settlement_id    INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL,                 -- building | upgrade | house
  building_type    TEXT NOT NULL,
  level            INTEGER NOT NULL DEFAULT 1,    -- the level it will be when finished
  neighbourhood_id INTEGER REFERENCES neighbourhoods(id) ON DELETE CASCADE,   -- a house: where it will stand
  plot             INTEGER,
  style            TEXT,
  cost             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- what was paid (for a refund)
  work_needed      NUMERIC NOT NULL,              -- builder-minutes
  work_done        NUMERIC NOT NULL DEFAULT 0,
  position         INTEGER NOT NULL,              -- place in the queue (lowest first)
  status           TEXT NOT NULL DEFAULT 'open',  -- open | done | cancelled
  workers          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- the builders who worked on it
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_construction_open ON construction_sites (settlement_id, position) WHERE status = 'open';

-- construction_on: building time is on for this town (the switch
-- `construction.on` turns it on for every town). construction_at: when the
-- sites were last worked on. construction_waiting: a "nobody is a builder"
-- news line has been written for the present wait (one line, not one a minute).
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS construction_on BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS construction_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS construction_waiting BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
