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
-- Which building's stalls an item listing sits on (market, smithy, ...).
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS venue TEXT;

-- Item listings are stalls now: buyers' porters collect, priced per unit.
-- Convert listings made under the old model (seller's merchants carried
-- lots): free their merchants and turn lot prices into unit prices.
-- Idempotent — only touches item orders that still have merchants or lots.
UPDATE citizens c SET role = 'idle'
  FROM market_order_merchants m JOIN market_orders o ON o.id = m.order_id
 WHERE c.id = m.citizen_id AND o.kind = 'item' AND c.role = 'merchant'
   AND NOT EXISTS (SELECT 1 FROM market_trips t WHERE t.citizen_id = c.id AND t.status IN ('outbound','returning'));
DELETE FROM market_order_merchants m USING market_orders o WHERE o.id = m.order_id AND o.kind = 'item';
UPDATE market_orders SET lot_price = GREATEST(1, CEIL(lot_price::numeric / lot_size)), lot_size = 1
 WHERE kind = 'item' AND lot_size > 1;
UPDATE market_orders SET venue = 'market' WHERE kind = 'item' AND venue IS NULL;

-- Shopkeepers: the citizen minding each shop (smithy, jeweller,
-- fishing_post). A shop's stalls only sell while it has one.
CREATE TABLE IF NOT EXISTS shop_keepers (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  venue          TEXT    NOT NULL,
  citizen_id     INTEGER NOT NULL UNIQUE REFERENCES citizens(id) ON DELETE CASCADE,
  PRIMARY KEY (settlement_id, venue)
);
COMMIT;
