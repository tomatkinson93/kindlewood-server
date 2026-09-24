-- 0NN_clan_territory.sql — clan territory, one clan per tile (spec 016 Phase 3)
-- Idempotent: db.js initDB() re-applies it on every boot (matched by the
-- `_clan_territory.sql` suffix). Rename 0NN at deploy time.
BEGIN;
CREATE TABLE IF NOT EXISTS clan_territory (
  q                   INTEGER NOT NULL,
  r                   INTEGER NOT NULL,
  clan_id             INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  claimed_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  claimed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (q, r)                      -- one clan per tile, globally
);
CREATE INDEX IF NOT EXISTS clan_territory_clan_idx ON clan_territory (clan_id);

-- Backfill: clans founded before this migration get their HQ seed tile.
INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id)
  SELECT c.hq_q, c.hq_r, c.id, c.founder_user_id FROM clans c
   WHERE c.hq_q IS NOT NULL AND c.hq_r IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM clan_territory t WHERE t.clan_id = c.id)
ON CONFLICT DO NOTHING;
COMMIT;
