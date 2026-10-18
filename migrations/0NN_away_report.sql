-- 0NN_away_report.sql — "Since you were gone…" splash. Additive; db.js
-- initDB() re-applies it on every boot (matched by the `_away_report.sql`
-- suffix).
-- away_since: when the player was last seen online (client heartbeat).
-- away_ledger: what the settlement produced / consumed since then, added up
-- by each production tick and consumption run (flat keys: produced_food,
-- consumed_food, …). Both reset by the heartbeat.
BEGIN;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS away_since TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS away_ledger JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_settlement_events_settlement_time ON settlement_events(settlement_id, created_at);
COMMIT;
