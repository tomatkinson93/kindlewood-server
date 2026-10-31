-- 0NN_tavern.sql — tavern card games: what the server paid out.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_tavern.sql`), so
-- every statement is idempotent.
--
-- tavern_games   one row per game the server knows about (lib/tavern_pay.js)
--   id           a solo game's ticket (issued when it starts; the browser
--                hands it back when the game ends), or a random id for a
--                multiplayer win the server paid itself
--   mode         'solo' | 'multiplayer'
--   used_at      when the result came in (NULL: a solo game still running)
--   won, paid    the result and the wealth paid for it (0 past the daily cap)
BEGIN;
CREATE TABLE IF NOT EXISTS tavern_games (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game        TEXT NOT NULL,
  mode        TEXT NOT NULL DEFAULT 'solo',
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ,
  won         BOOLEAN,
  paid        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tavern_games_user_used ON tavern_games (user_id, used_at);
COMMIT;
