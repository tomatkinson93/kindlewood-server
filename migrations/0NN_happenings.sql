-- 0NN_happenings.sql — Happenings: scheduled timed events (spec 021 Phase 6).
-- Additive; db.js initDB() re-applies it on every boot (matched by the
-- `_happenings.sql` suffix). Activity is computed from `rule` (shared
-- day_cycle.windowsBetween), never stored — there is no background job.
BEGIN;
CREATE TABLE IF NOT EXISTS happenings (
  id          TEXT PRIMARY KEY,               -- slug, e.g. 'lantern_walk'
  title       TEXT NOT NULL,
  flavour     TEXT NOT NULL DEFAULT '',
  icon        TEXT NOT NULL DEFAULT '🏮',
  rule        JSONB NOT NULL,                 -- recurrence (spec §6.2)
  effects     JSONB NOT NULL DEFAULT '[]',    -- banner / enemy_pool / map_flourish (§6.3)
  rewarding   BOOLEAN NOT NULL DEFAULT FALSE, -- drives the fairness check (§6.5)
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  archived    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
COMMIT;
