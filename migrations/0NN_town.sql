-- 0NN_town.sql — a town's own bonuses and upkeep (lib/town_mods.js).
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_town.sql`), so every
-- statement is idempotent.
--
-- settlements.festival_started_at / festival_until   a festival running (24h)
-- settlements.festival_cooldown_until                 when the next one may start
-- settlements.arrears_since   set while the treasury can't cover upkeep
--                             (wonder bonuses off, happiness down)
BEGIN;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS festival_started_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS festival_until TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS festival_cooldown_until TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS arrears_since TIMESTAMPTZ;
COMMIT;
