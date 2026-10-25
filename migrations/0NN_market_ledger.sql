-- 0NN_market_ledger.sql — Market trade record: price history and the Ledger.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_market_ledger.sql`),
-- so every statement is idempotent. Runs after 0NN_market_npc.sql.
--
-- market_trades: one row per deal, written when its price is agreed
--   (lib/market_ledger.js record()).
--   kind          lot | pickup | fill | ironhaven | npc
--   source/_id    the market_trips ('trip') or market_runs ('run') row
--   quality       crafted quality, 'basic' for everything else
--   seller/buyer  settlement ids; NULL for Ironhaven or a village
--   delivered_at  goods reached the buyer; paid_at gold reached the seller
--   failed        a pickup that found the stall empty (gold went back)
--   price_signal  player-to-player deals: these make the price history
BEGIN;
CREATE TABLE IF NOT EXISTS market_trades (
  id                    SERIAL PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('lot','pickup','fill','ironhaven','npc')),
  source                TEXT NOT NULL CHECK (source IN ('trip','run')),
  source_id             INTEGER NOT NULL,
  good_type             TEXT NOT NULL CHECK (good_type IN ('resource','item')),
  resource              TEXT,
  item_key              TEXT,
  quality               TEXT NOT NULL DEFAULT 'basic',
  item_name             TEXT,
  item_icon             TEXT,
  item_snapshot         JSONB,
  qty                   INTEGER NOT NULL CHECK (qty > 0),
  gold                  INTEGER NOT NULL CHECK (gold >= 0),
  fee                   INTEGER NOT NULL DEFAULT 0 CHECK (fee >= 0),
  unit_price            NUMERIC(14,4) NOT NULL,
  seller_settlement_id  INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
  buyer_settlement_id   INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
  seller_name           TEXT,
  buyer_name            TEXT,
  citizen_name          TEXT,
  citizen_side          TEXT CHECK (citizen_side IN ('seller','buyer')),
  agreed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at          TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  failed                BOOLEAN NOT NULL DEFAULT FALSE,
  price_signal          BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS market_trades_price_idx
  ON market_trades (good_type, resource, item_key, quality, agreed_at) WHERE price_signal AND NOT failed;
CREATE INDEX IF NOT EXISTS market_trades_seller_idx ON market_trades (seller_settlement_id, agreed_at DESC);
CREATE INDEX IF NOT EXISTS market_trades_buyer_idx  ON market_trades (buyer_settlement_id, agreed_at DESC);
CREATE INDEX IF NOT EXISTS market_trades_recent_idx ON market_trades (agreed_at) WHERE price_signal AND NOT failed;

-- Backfill the trips and runs made before the ledger existed — once. Every
-- deal since is recorded by lib/market_ledger.js record(), so re-scanning all
-- history on every boot would only slow startup. migration_marks remembers.
CREATE TABLE IF NOT EXISTS migration_marks (
  key      TEXT PRIMARY KEY,
  done_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $backfill$
BEGIN
IF NOT EXISTS (SELECT 1 FROM migration_marks WHERE key = 'market_ledger_backfill') THEN
INSERT INTO market_trades (kind, source, source_id, good_type, resource, item_key, quality, item_name, item_icon, item_snapshot,
                           qty, gold, fee, unit_price, seller_settlement_id, buyer_settlement_id, seller_name, buyer_name,
                           citizen_name, citizen_side, agreed_at, delivered_at, paid_at, price_signal)
SELECT 'lot', 'trip', t.id, CASE WHEN t.kind = 'item' THEN 'item' ELSE 'resource' END,
       CASE WHEN t.kind = 'item' THEN NULL ELSE t.resource END, t.item_key,
       CASE WHEN t.item_snapshot->'metadata' ? 'crafted_by' THEN COALESCE(t.item_snapshot->'metadata'->>'quality', 'basic') ELSE 'basic' END,
       t.item_snapshot->>'name', t.item_snapshot->>'icon', t.item_snapshot,
       t.qty, t.gold_paid, t.fee, t.gold_paid::numeric / t.qty, t.seller_settlement_id, t.buyer_settlement_id, ss.name, bs.name,
       c.name, 'seller', t.departs_at,
       CASE WHEN t.status <> 'outbound' THEN t.arrives_at END, CASE WHEN t.status = 'done' THEN t.returns_at END, TRUE
  FROM market_trips t
  LEFT JOIN settlements ss ON ss.id = t.seller_settlement_id
  LEFT JOIN settlements bs ON bs.id = t.buyer_settlement_id
  LEFT JOIN citizens c ON c.id = t.citizen_id
ON CONFLICT (source, source_id) DO NOTHING;

INSERT INTO market_trades (kind, source, source_id, good_type, resource, item_key, quality, item_name, item_icon, item_snapshot,
                           qty, gold, fee, unit_price, seller_settlement_id, buyer_settlement_id, seller_name, buyer_name,
                           citizen_name, citizen_side, agreed_at, delivered_at, paid_at, failed, price_signal)
SELECT r.kind, 'run', r.id, CASE WHEN r.item_snapshot IS NOT NULL THEN 'item' ELSE 'resource' END,
       CASE WHEN r.item_snapshot IS NULL THEN r.resource END, r.item_key,
       CASE WHEN r.item_snapshot->'metadata' ? 'crafted_by' THEN COALESCE(r.item_snapshot->'metadata'->>'quality', 'basic') ELSE 'basic' END,
       r.item_snapshot->>'name', r.item_snapshot->>'icon', r.item_snapshot,
       r.qty, r.gold, r.fee, r.gold::numeric / r.qty,
       -- who sold: the target for a pickup; nobody (a village) when the player bought from one
       CASE WHEN r.kind = 'pickup' THEN r.target_settlement_id WHEN r.kind = 'npc' AND r.side = 'buy' THEN NULL ELSE r.settlement_id END,
       CASE WHEN r.kind = 'pickup' THEN r.settlement_id WHEN r.kind = 'fill' THEN r.target_settlement_id
            WHEN r.kind = 'npc' AND r.side = 'buy' THEN r.settlement_id END,
       CASE WHEN r.kind = 'pickup' THEN r.target_name WHEN r.kind = 'npc' AND r.side = 'buy' THEN r.target_name ELSE s.name END,
       CASE WHEN r.kind IN ('pickup') THEN s.name WHEN r.kind = 'fill' THEN r.target_name
            WHEN r.kind = 'ironhaven' THEN r.target_name WHEN r.kind = 'npc' AND r.side = 'buy' THEN s.name ELSE r.target_name END,
       c.name, CASE WHEN r.kind = 'pickup' OR (r.kind = 'npc' AND r.side = 'buy') THEN 'buyer' ELSE 'seller' END,
       r.departs_at,
       CASE WHEN r.status <> 'outbound' AND r.kind IN ('fill','ironhaven') THEN r.arrives_at WHEN r.status = 'done' THEN r.returns_at END,
       CASE WHEN r.failed THEN NULL WHEN r.status <> 'outbound' AND r.kind = 'pickup' THEN r.arrives_at WHEN r.status = 'done' THEN r.returns_at END,
       r.failed, r.kind IN ('pickup','fill')
  FROM market_runs r
  JOIN settlements s ON s.id = r.settlement_id
  LEFT JOIN citizens c ON c.id = r.citizen_id
ON CONFLICT (source, source_id) DO NOTHING;

INSERT INTO migration_marks (key) VALUES ('market_ledger_backfill');
END IF;
END
$backfill$;
COMMIT;
