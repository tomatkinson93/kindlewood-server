-- 0NN_market.sql — player-to-player Market (sell orders + merchant caravans).
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by the `_market.sql` suffix).
--
-- market_orders: a seller's listing. Goods are escrowed on listing —
--   qty_escrowed is what is still held by the order (not yet dispatched).
-- market_order_merchants: citizens working an order (one order each).
-- market_trips: one bought lot. outbound → (goods credited to buyer) →
--   returning → (gold minus fee credited to seller) → done.
BEGIN;

CREATE TABLE IF NOT EXISTS market_orders (
  id                    SERIAL PRIMARY KEY,
  seller_settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  kind                  TEXT    NOT NULL DEFAULT 'resource' CHECK (kind IN ('resource','item')),
  resource              TEXT    NOT NULL,
  lot_size              INTEGER NOT NULL CHECK (lot_size > 0),
  lot_price             INTEGER NOT NULL CHECK (lot_price > 0),
  qty_total             INTEGER NOT NULL CHECK (qty_total > 0),
  qty_escrowed          INTEGER NOT NULL CHECK (qty_escrowed >= 0),
  status                TEXT    NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','sold_out','cancelled','expired')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at            TIMESTAMPTZ NOT NULL,
  closed_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS market_orders_seller_idx ON market_orders (seller_settlement_id, status);
CREATE INDEX IF NOT EXISTS market_orders_active_idx ON market_orders (status, expires_at);

CREATE TABLE IF NOT EXISTS market_order_merchants (
  order_id    INTEGER NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  citizen_id  INTEGER NOT NULL UNIQUE REFERENCES citizens(id) ON DELETE CASCADE,
  PRIMARY KEY (order_id, citizen_id)
);

CREATE TABLE IF NOT EXISTS market_trips (
  id                    SERIAL PRIMARY KEY,
  order_id              INTEGER NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  seller_settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  buyer_settlement_id   INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  citizen_id            INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  resource              TEXT    NOT NULL,
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  gold_paid             INTEGER NOT NULL CHECK (gold_paid >= 0),
  fee                   INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  distance              INTEGER NOT NULL DEFAULT 0,
  status                TEXT    NOT NULL DEFAULT 'outbound'
                        CHECK (status IN ('outbound','returning','done')),
  departs_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrives_at            TIMESTAMPTZ NOT NULL,
  returns_at            TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS market_trips_outbound_idx  ON market_trips (status, arrives_at);
CREATE INDEX IF NOT EXISTS market_trips_returning_idx ON market_trips (status, returns_at);
CREATE INDEX IF NOT EXISTS market_trips_seller_idx    ON market_trips (seller_settlement_id, status);
CREATE INDEX IF NOT EXISTS market_trips_buyer_idx     ON market_trips (buyer_settlement_id, status);
CREATE INDEX IF NOT EXISTS market_trips_citizen_idx   ON market_trips (citizen_id, status);

-- Clanmates always know where each other live: reveal every existing
-- clanmate's town tile to each member (joins do the same from now on).
INSERT INTO fog_of_war (user_id, tile_q, tile_r)
SELECT a.user_id, s.tile_q, s.tile_r
  FROM clan_members a
  JOIN clan_members b ON b.clan_id = a.clan_id AND b.user_id <> a.user_id
  JOIN settlements s  ON s.user_id = b.user_id
 WHERE s.tile_q IS NOT NULL AND s.tile_r IS NOT NULL
ON CONFLICT DO NOTHING;

COMMIT;
