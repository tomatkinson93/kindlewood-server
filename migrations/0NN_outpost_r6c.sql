-- R6c: haul filters, roads, outpost events, clanmates' porters. Idempotent.
-- The outposts table comes later on a fresh database (POST /api/game/migrate
-- adds these columns itself), so its parts are guarded.
DO $$ BEGIN
  IF to_regclass('public.outposts') IS NOT NULL THEN
    -- What porters bring home (NULL = everything) and how full the store
    -- gets before a standing hauler sets out (% of the cap; 0 = any).
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS haul_filter JSONB;
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS haul_threshold INTEGER NOT NULL DEFAULT 0;
    -- The road to town: level 0 none, 1 track, 2 paved; the newest level
    -- counts from road_ready_at.
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS road_level INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS road_ready_at TIMESTAMPTZ;
    -- When the outpost last rolled for an event (lib/outpost_events).
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS event_roll_at TIMESTAMPTZ;
  END IF;
END $$;

-- Happenings at an outpost that ask the player to choose (lib/outpost_events).
CREATE TABLE IF NOT EXISTS outpost_events (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL,
  outpost_id     INTEGER NOT NULL,
  kind           TEXT NOT NULL,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  resolved_at    TIMESTAMPTZ,
  choice         TEXT,
  outcome        TEXT
);
CREATE INDEX IF NOT EXISTS idx_outpost_events_open ON outpost_events (settlement_id) WHERE resolved_at IS NULL;

-- A clanmate's porter fetching from someone else's outpost: the goods go to
-- the outpost's owner (owner_settlement_id); NULL = the porter's own town.
ALTER TABLE outpost_hauls ADD COLUMN IF NOT EXISTS owner_settlement_id INTEGER;
