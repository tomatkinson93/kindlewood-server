-- 0NN_market_npc.sql — NPC village traders at the Market.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by the `_market_npc.sql`
-- suffix). Runs after 0NN_market_v2.sql.
--
-- Village orders are generated per UTC day (lib/npc_trade.js); only each
-- player's use of them is stored.
--   npc_trade_usage: units of a village's order a settlement took that day
--   npc_trade_trust: trust gained from trading that day (capped)
-- market_runs kind 'npc': a porter trading with a village; side is the
-- player's side ('buy' = the player buys from the village).
BEGIN;
CREATE TABLE IF NOT EXISTS npc_trade_usage (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  npc_id         INTEGER NOT NULL REFERENCES npc_settlements(id) ON DELETE CASCADE,
  day            DATE    NOT NULL,
  order_key      TEXT    NOT NULL,
  qty            INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  PRIMARY KEY (settlement_id, npc_id, day, order_key)
);
CREATE TABLE IF NOT EXISTS npc_trade_trust (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  npc_id         INTEGER NOT NULL REFERENCES npc_settlements(id) ON DELETE CASCADE,
  day            DATE    NOT NULL,
  gained         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (settlement_id, npc_id, day)
);
ALTER TABLE market_runs ADD COLUMN IF NOT EXISTS npc_id INTEGER REFERENCES npc_settlements(id) ON DELETE SET NULL;
ALTER TABLE market_runs ADD COLUMN IF NOT EXISTS side TEXT;
ALTER TABLE market_runs ADD COLUMN IF NOT EXISTS order_key TEXT;
ALTER TABLE market_runs ADD COLUMN IF NOT EXISTS trade_day DATE;
ALTER TABLE market_runs DROP CONSTRAINT IF EXISTS market_runs_kind_check;
ALTER TABLE market_runs ADD CONSTRAINT market_runs_kind_check CHECK (kind IN ('ironhaven','pickup','fill','npc'));
COMMIT;
