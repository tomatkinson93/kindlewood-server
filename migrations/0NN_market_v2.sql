-- 0NN_market_v2.sql — Market v2: porter runs (Ironhaven sales, item
-- pickups). Rename 0NN to the next free migration number at deploy time;
-- db.js initDB() re-applies it on every boot (matched by the
-- `_market_v2.sql` suffix). Runs after 0NN_market_items.sql.
--
-- market_runs: one citizen walking somewhere and back for the Market.
--   kind 'ironhaven' — carries items to sell to Ironhaven; gold (fixed
--     at dispatch) is credited when the porter is home.
--   kind 'pickup'    — a buyer's porter collecting from a seller's stall;
--     the held gold goes to the seller on arrival, the items to the buyer
--     on return (or the gold back to the buyer if the stall ran out).
BEGIN;
CREATE TABLE IF NOT EXISTS market_runs (
  id                    SERIAL PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('ironhaven','pickup')),
  settlement_id         INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  citizen_id            INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  order_id              INTEGER REFERENCES market_orders(id) ON DELETE SET NULL,
  target_settlement_id  INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
  target_name           TEXT,
  target_q              INTEGER,
  target_r              INTEGER,
  item_key              TEXT,
  item_snapshot         JSONB,
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  gold                  INTEGER NOT NULL DEFAULT 0 CHECK (gold >= 0),
  fee                   INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  distance              INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'outbound' CHECK (status IN ('outbound','returning','done')),
  failed                BOOLEAN NOT NULL DEFAULT FALSE,
  departs_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrives_at            TIMESTAMPTZ NOT NULL,
  returns_at            TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS market_runs_outbound_idx  ON market_runs (status, arrives_at);
CREATE INDEX IF NOT EXISTS market_runs_returning_idx ON market_runs (status, returns_at);
CREATE INDEX IF NOT EXISTS market_runs_settlement_idx ON market_runs (settlement_id, status);
CREATE INDEX IF NOT EXISTS market_runs_citizen_idx   ON market_runs (citizen_id, status);

-- Units on a stall that a buyer's porter is on the way to collect.
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS qty_reserved INTEGER NOT NULL DEFAULT 0;
COMMIT;
