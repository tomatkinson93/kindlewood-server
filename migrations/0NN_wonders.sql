-- 0NN_wonders.sql — a City's Wonders (lib/wonders.js).
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_wonders.sql`), so every
-- statement is idempotent.
--
-- settlement_wonders   one row per wonder a town has started
--   stage              stages finished (0–3; 3 = complete)
--   building_until     the stage being built finishes then (NULL: none)
--   completed_at       when the last stage finished
BEGIN;
CREATE TABLE IF NOT EXISTS settlement_wonders (
  settlement_id   INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  wonder_key      TEXT NOT NULL,
  stage           INTEGER NOT NULL DEFAULT 0,
  building_until  TIMESTAMPTZ,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  PRIMARY KEY (settlement_id, wonder_key)
);
COMMIT;
