-- 0NN_rankings.sql — what the rankings read that nothing else stored.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_rankings.sql`), so
-- every statement is idempotent.
--
-- fishing_catches   one row per fish landed (routes/fishing.js /land) — the
--                   Biggest Fish (most valuable) and Most Fish boards.
BEGIN;
CREATE TABLE IF NOT EXISTS fishing_catches (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fish_id     TEXT NOT NULL,
  fish_name   TEXT NOT NULL,
  value       INTEGER NOT NULL DEFAULT 0,
  caught_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fishing_catches_user_idx ON fishing_catches (user_id);
COMMIT;
