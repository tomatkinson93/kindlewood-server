-- A lost thing each day (docs/HOME_SCENE.md Part F, F.8; lib/lost.js).
BEGIN;

-- One small thing a villager has lost, per town per game day. The row is made
-- the first time the day's thing is asked for; `found_at` is set once, by
-- whichever device finds it. Old days are cleared as new ones are made
-- (lib/lost.js KEEP_DAYS).
CREATE TABLE IF NOT EXISTS lost_things (
  id            SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  day           INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  owner_id      INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  owner_name    TEXT NOT NULL,
  seed          INTEGER NOT NULL,          -- where it lies: the scene places it from this
  found_at      TIMESTAMPTZ,
  reward        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (settlement_id, day)
);

COMMIT;
