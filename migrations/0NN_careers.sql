-- 0NN_careers.sql — citizen careers: class levels, skill trees, hidden
-- trait reveals, earned traits; equipment that counts (one item per slot).
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by the `_careers.sql`
-- suffix), so every statement is idempotent. Runs after 0NN_market_npc.sql.
--
--   citizen_classes   one row per citizen per class they have worked:
--                     XP (level is a cache of it), the fork they chose at
--                     Lv10, perk ranks bought, hours worked, counters.
--   citizens.career_* the passive-XP clock, hidden-trait reveals and hints,
--                     earned traits, deed counters. career_rolled = FALSE
--                     marks rows from before careers (they get one roll of
--                     career traits); new rows default to TRUE.
BEGIN;
CREATE TABLE IF NOT EXISTS citizen_classes (
  citizen_id     INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  class_key      TEXT    NOT NULL,
  xp             NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level          SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 1 AND 20),
  spec           TEXT,
  nodes          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  hours_worked   NUMERIC(10,2) NOT NULL DEFAULT 0,
  counters       JSONB   NOT NULL DEFAULT '{}'::jsonb,
  retrain_until  TIMESTAMPTZ,
  retrains       SMALLINT NOT NULL DEFAULT 0,
  first_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (citizen_id, class_key)
);
CREATE INDEX IF NOT EXISTS citizen_classes_settlement_idx ON citizen_classes (settlement_id);

ALTER TABLE citizens ADD COLUMN IF NOT EXISTS career_settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS revealed_traits  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS trait_hints      JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS earned_traits    JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS career_counters  JSONB NOT NULL DEFAULT '{}'::jsonb;
-- Existing rows get FALSE (rolled once by lib/careers); new rows TRUE.
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS career_rolled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE citizens ALTER COLUMN career_rolled SET DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS citizens_career_settled_idx ON citizens (career_settled_at)
  WHERE COALESCE(life_stage, 'adult') <> 'deceased';

-- Equipment counts now: only real equipment, only living citizens, one
-- item per slot (the newest equipped piece wins).
UPDATE inventory_items SET equipped_to = NULL WHERE equipped_to IS NOT NULL AND equip_slot IS NULL;
UPDATE inventory_items i SET equipped_to = NULL FROM citizens c
 WHERE c.id = i.equipped_to AND c.life_stage = 'deceased';
UPDATE inventory_items i SET equipped_to = NULL WHERE i.equipped_to IS NOT NULL AND EXISTS (
  SELECT 1 FROM inventory_items j WHERE j.equipped_to = i.equipped_to AND j.equip_slot = i.equip_slot AND j.id > i.id);
CREATE UNIQUE INDEX IF NOT EXISTS inv_one_item_per_slot ON inventory_items (equipped_to, equip_slot)
  WHERE equipped_to IS NOT NULL;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS quality TEXT;
-- Scouts' reveal perks, fixed when the expedition sets out.
ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS reveal_bonus SMALLINT NOT NULL DEFAULT 0;

-- The Mine (miners' workplace): Badger starter quarries become mines.
UPDATE buildings b SET type = 'mine' WHERE b.type = 'quarry'
   AND NOT EXISTS (SELECT 1 FROM buildings m WHERE m.settlement_id = b.settlement_id AND m.type = 'mine');
-- Materials some specialists find (hide, wool, prize rosettes).
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, sell_value)
VALUES ('hide', 'Hide', 'A cured animal hide. Tanners will want it.', '🟫', 'material', 'common', 1, 'basic', 6),
       ('wool', 'Wool', 'A fleece of soft wool, ready for spinning.', '🧶', 'material', 'common', 1, 'basic', 6),
       ('prize_ram', 'Prize Ram Rosette', 'Won by the finest ram in the valley.', '🏆', 'trophy', 'rare', 3, 'basic', 60)
ON CONFLICT (item_key) DO NOTHING;
COMMIT;
