-- 0NN_happening_modifiers.sql — Happening combat modifiers frozen per battle
-- (spec 021 Phase 6 follow-up). Additive; db.js initDB() re-applies it on
-- every boot (matched by the `_happening_modifiers.sql` suffix).
-- A quest battle is replayed from its action log on every move, so the
-- Happening modifiers in force when the encounter triggered are stored here
-- and used for every replay — a Happening ending mid-fight can't change it.
BEGIN;
ALTER TABLE settlement_quests ADD COLUMN IF NOT EXISTS combat_mods JSONB DEFAULT NULL;
COMMIT;
