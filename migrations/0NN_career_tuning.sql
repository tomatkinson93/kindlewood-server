-- 0NN_career_tuning.sql — balance knobs Dev Tools can turn without a deploy.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_career_tuning.sql`), so
-- every statement is idempotent. Seeds never overwrite an edited value.
--
-- career_tuning  key → multiplier (1 = as designed), read through
--                lib/tuning.js (cached; refreshed every 30 s and on save)
BEGIN;
CREATE TABLE IF NOT EXISTS career_tuning (
  key         TEXT PRIMARY KEY,
  value       NUMERIC(6,3) NOT NULL DEFAULT 1 CHECK (value >= 0 AND value <= 5),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO career_tuning (key, value) VALUES
  ('passive_xp', 1), ('craft_xp', 1), ('discovery', 1), ('research', 1), ('ore', 1)
ON CONFLICT (key) DO NOTHING;
COMMIT;
