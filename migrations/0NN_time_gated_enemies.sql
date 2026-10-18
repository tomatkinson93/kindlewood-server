-- 0NN_time_gated_enemies.sql — nocturnal / lunar creatures (spec 021 Phase 5).
-- Additive; db.js initDB() re-applies it on every boot (matched by the
-- `_time_gated_enemies.sql` suffix).
--   active_phases  e.g. ["dusk","night"]   NULL = any time of day
--   moon_phases    e.g. ["full"]           NULL = any moon
-- Ids are KWDayCycle's PHASE_IDS / MOON_IDS. The admin form stores an empty
-- selection as NULL. Read by lib/time_gates.js for random enemy picks only.
BEGIN;
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS active_phases JSONB DEFAULT NULL;
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS moon_phases   JSONB DEFAULT NULL;
COMMIT;
