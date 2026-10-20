-- 0NN_market_items.sql — item trading at the Market + the "tradeable" trait.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by the `_market_items.sql`
-- suffix). Runs after 0NN_market.sql.
--
-- tradeable: when false the item can't be listed at the Market or traded in
--   any other way. On item_templates it is set in Dev Tools and applies to
--   every copy of the item; on inventory_items it marks a single stack (for
--   one-off rewards). An item is tradeable only when both allow it. Every
--   existing item starts tradeable.
-- market_orders / market_trips: an item order carries item_key plus a
--   snapshot of the item (name, icon, rarity, category, slot, stats,
--   metadata) taken when it was listed; resource is NULL for items.
BEGIN;
ALTER TABLE item_templates  ADD COLUMN IF NOT EXISTS tradeable BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS tradeable BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS item_key TEXT;
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS item_snapshot JSONB;
ALTER TABLE market_orders ALTER COLUMN resource DROP NOT NULL;

ALTER TABLE market_trips ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'resource';
ALTER TABLE market_trips ADD COLUMN IF NOT EXISTS item_key TEXT;
ALTER TABLE market_trips ADD COLUMN IF NOT EXISTS item_snapshot JSONB;
ALTER TABLE market_trips ALTER COLUMN resource DROP NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'market_orders_goods_chk') THEN
    ALTER TABLE market_orders ADD CONSTRAINT market_orders_goods_chk CHECK (
      (kind = 'resource' AND resource IS NOT NULL) OR (kind = 'item' AND item_key IS NOT NULL AND item_snapshot IS NOT NULL));
  END IF;
END $$;
COMMIT;
