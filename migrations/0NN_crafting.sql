-- 0NN_crafting.sql — crafting (careers Phase 2): recipes, craft jobs,
-- first-craft tracking, the items crafters make, and the starting recipes.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_crafting.sql`), so
-- every statement is idempotent. Runs after 0NN_careers.sql.
--
--   recipes          what each crafting class can make (Dev Tools edits these).
--                    inputs: { "resources": { "metal": 10 }, "items": [{ "item_key": "iron_ore", "qty": 1 }] }
--                    unlock_node: a skill-tree perk that must be learned first.
--   craft_jobs       one item being (or waiting to be) made by one crafter.
--                    reserved: exactly what was taken, refunded on cancel.
--   citizen_recipes  what a citizen has made before (first craft pays ×2 XP).
-- Recipe seeds are inserted only if missing, so Dev Tools edits survive boot.
BEGIN;
CREATE TABLE IF NOT EXISTS recipes (
  recipe_key         TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  class_key          TEXT NOT NULL,
  spec               TEXT,
  station            TEXT NOT NULL,
  min_level          SMALLINT NOT NULL DEFAULT 1,
  min_station_level  SMALLINT NOT NULL DEFAULT 1,
  inputs             JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_key         TEXT NOT NULL,
  output_qty         SMALLINT NOT NULL DEFAULT 1,
  base_seconds       INTEGER NOT NULL DEFAULT 1200,
  base_xp            INTEGER NOT NULL DEFAULT 20,
  unlock_node        TEXT,
  quality_cap        TEXT NOT NULL DEFAULT 'legendary',
  archived           BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS craft_jobs (
  id               SERIAL PRIMARY KEY,
  settlement_id    INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  citizen_id       INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  recipe_key       TEXT NOT NULL,
  recipe_snapshot  JSONB NOT NULL,
  station          TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','active','done','cancelled','ruined')),
  position         INTEGER NOT NULL DEFAULT 0,
  reserved         JSONB NOT NULL DEFAULT '{}'::jsonb,
  options          JSONB NOT NULL DEFAULT '{}'::jsonb,
  queued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completes_at     TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  quality          TEXT,
  roll             JSONB,
  result_item_id   INTEGER,
  xp_awarded       NUMERIC(10,2)
);
CREATE INDEX IF NOT EXISTS craft_jobs_due_idx ON craft_jobs (completes_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS craft_jobs_citizen_idx ON craft_jobs (citizen_id, status);
CREATE INDEX IF NOT EXISTS craft_jobs_settlement_idx ON craft_jobs (settlement_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS craft_jobs_one_active ON craft_jobs (citizen_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS citizen_recipes (
  citizen_id  INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  recipe_key  TEXT NOT NULL,
  first_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (citizen_id, recipe_key)
);

-- The old Artisan job is retired: Artisans go foraging (test phase).
UPDATE citizens SET role = 'forager' WHERE role = 'crafter';

-- What crafters make (only added if missing — Dev Tools edits survive).
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value, armor_class, item_effects) VALUES
  ('iron_dagger',     'Iron Dagger',     'A short, honest blade.',                         '🗡️', 'equipment', 'common',    1, 'basic', 'weapon',  '{"combat":1}',                 12, NULL, NULL),
  ('war_hammer',      'War Hammer',      'Heavy enough to dent a shield.',                 '🔨', 'equipment', 'uncommon',  2, 'basic', 'weapon',  '{"combat":4}',                 60, NULL, NULL),
  ('halberd',         'Halberd',         'Axe, spike and hook on a long pole.',            '🔱', 'equipment', 'rare',      3, 'basic', 'weapon',  '{"combat":5}',                 85, NULL, NULL),
  ('scale_mail',      'Scale Mail',      'Overlapping plates like a fish''s scales.',      '🐟', 'equipment', 'uncommon',  2, 'basic', 'armour',  '{"combat":3}',                 70, 5,    NULL),
  ('plate_armour',    'Plate Armour',    'Head to toe in hammered steel.',                 '🛡️', 'equipment', 'rare',      3, 'basic', 'armour',  '{"combat":4}',                110, 7,    NULL),
  ('miners_pick',     'Miner''s Pick',   'A sharp, well-weighted pick.',                   '⛏️', 'equipment', 'common',    1, 'basic', 'tool',    '{"mining":3}',                 22, NULL, NULL),
  ('woodsmans_axe',   'Woodsman''s Axe', 'Bites deep, swings true.',                       '🪓', 'equipment', 'common',    1, 'basic', 'tool',    '{"woodcutting":3}',            22, NULL, NULL),
  ('farmers_hoe',     'Farmer''s Hoe',   'Turns soil like butter.',                        '🌱', 'equipment', 'common',    1, 'basic', 'tool',    '{"farming":3}',                20, NULL, NULL),
  ('smiths_hammer',   'Smith''s Hammer', 'Every smith swears by their own.',               '🔨', 'equipment', 'common',    1, 'basic', 'tool',    '{"crafting":3}',               26, NULL, NULL),
  ('jewellers_loupe', 'Jeweller''s Loupe','Sees every flaw.',                              '🔍', 'equipment', 'common',    1, 'basic', 'tool',    '{"crafting":3}',               24, NULL, NULL),
  ('carpenters_plane','Carpenter''s Plane','Leaves the wood smooth as glass.',             '🪚', 'equipment', 'common',    1, 'basic', 'tool',    '{"crafting":3}',               20, NULL, NULL),
  ('silver_ring',     'Silver Ring',     'A plain band, nicely made.',                     '💍', 'equipment', 'common',    1, 'basic', 'trinket', '{"crafting":1}',               30, NULL, NULL),
  ('scouts_charm',    'Scout''s Charm',  'A compass-rose charm on a cord.',                '🧭', 'equipment', 'uncommon',  2, 'basic', 'trinket', '{"scouting":2}',               45, NULL, NULL),
  ('anglers_charm',   'Angler''s Charm', 'A tiny silver fish that never sinks.',           '🎣', 'equipment', 'uncommon',  2, 'basic', 'trinket', '{"fishing":2}',                45, NULL, NULL),
  ('cut_gem',         'Cut Gem',         'A gemstone, faceted and gleaming.',              '💎', 'material',  'rare',      3, 'basic', NULL,      '{}',                          90, NULL, NULL),
  ('gem_pendant',     'Gem Pendant',     'A cut gem that catches every light.',            '📿', 'equipment', 'rare',      3, 'basic', 'trinket', '{"scouting":2,"combat":1}',   140, NULL, NULL),
  ('heart_of_the_mountain', 'Heart of the Mountain', 'A pendant that seems to beat.',      '❤️‍🔥', 'equipment', 'legendary', 5, 'basic', 'trinket', '{"scouting":3,"combat":3}',   600, NULL, NULL),
  ('gold_ring',       'Gold Ring',       'Heavy, warm and very valuable.',                 '🪙', 'equipment', 'uncommon',  2, 'basic', 'trinket', '{}',                          160, NULL, NULL),
  ('signet_ring',     'Signet Ring',     'Seals deals. Merchants pay lower fees with one.','🔏', 'equipment', 'rare',      3, 'basic', 'trinket', '{}',                          150, NULL, '[{"type":"fee","value":-0.05}]'),
  ('handcart',        'Handcart',        'Two wheels and a sturdy bed. Porters carry more.','🛒', 'equipment', 'common',    1, 'basic', 'tool',    '{}',                           40, NULL, '[{"type":"carry","value":0.15}]'),
  ('pack_frame',      'Pack Frame',      'A frame that spreads the load.',                 '🎒', 'equipment', 'uncommon',  2, 'basic', 'tool',    '{}',                           50, NULL, '[{"type":"carry","value":0.1},{"type":"travel","value":0.05}]'),
  ('caravan_wagon',   'Caravan Wagon',   'A merchant''s pride: canvas, wheels and room.',  '🚚', 'equipment', 'rare',      3, 'basic', 'tool',    '{}',                          120, NULL, '[{"type":"carry","value":0.3}]'),
  ('shortbow',        'Shortbow',        'Quick to draw, easy to carry.',                  '🏹', 'equipment', 'common',    1, 'basic', 'weapon',  '{"combat":2}',                 35, NULL, NULL),
  ('longbow',         'Longbow',         'Taller than its archer.',                        '🏹', 'equipment', 'uncommon',  2, 'basic', 'weapon',  '{"combat":4}',                 70, NULL, NULL),
  ('heartwood_bow',   'Heartwood Longbow','Cut from the heart of an ancient tree.',        '🌲', 'equipment', 'legendary', 5, 'basic', 'weapon',  '{"combat":6}',                300, NULL, NULL)
ON CONFLICT (item_key) DO NOTHING;

-- Items the recipes use that older databases may lack (never overwritten).
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value, armor_class) VALUES
  ('iron_sword',  'Iron Sword',  '', '⚔️', 'equipment', 'common',   1, 'sturdy', 'weapon', '{"combat":2}', 20, NULL),
  ('steel_sword', 'Steel Sword', '', '🗡️', 'equipment', 'rare',     3, 'fine',   'weapon', '{"combat":4}', 55, NULL),
  ('chainmail',   'Chainmail',   '', '🔗', 'equipment', 'uncommon', 2, 'sturdy', 'armour', '{"combat":2}', 40, 4),
  ('fishers_rod', 'Fisher''s Rod','', '🎣', 'equipment', 'uncommon', 2, 'sturdy', 'tool',   '{"fishing":3}', 25, NULL),
  ('iron_ore',    'Iron Ore',    '', '⚫', 'material',  'common',   1, 'basic',  NULL, '{}', 8,  NULL),
  ('gemstone',    'Gemstone',    '', '💎', 'material',  'rare',     3, 'basic',  NULL, '{}', 50, NULL),
  ('rare_sap',    'Rare Sap',    '', '🫙', 'material',  'uncommon', 2, 'basic',  NULL, '{}', 20, NULL),
  ('ancient_heartwood', 'Ancient Heartwood', '', '🪵', 'material', 'rare', 3, 'basic', NULL, '{}', 45, NULL)
ON CONFLICT (item_key) DO NOTHING;

-- Starting recipes. resources: food/timber/stone/metal/wealth.
INSERT INTO recipes (recipe_key, name, class_key, spec, station, min_level, min_station_level, inputs, output_key, base_seconds, base_xp, unlock_node, quality_cap, sort_order) VALUES
  -- Blacksmith
  ('iron_dagger',    'Iron Dagger',    'blacksmith', NULL,          'smithy',   1, 1, '{"resources":{"metal":8,"timber":2}}',                                       'iron_dagger',    1200, 15, NULL, 'legendary', 10),
  ('iron_sword',     'Iron Sword',     'blacksmith', NULL,          'smithy',   3, 1, '{"resources":{"metal":15,"timber":3},"items":[{"item_key":"iron_ore","qty":1}]}', 'iron_sword', 2400, 30, NULL, 'legendary', 20),
  ('smiths_hammer',  'Smith''s Hammer','blacksmith', NULL,          'smithy',   6, 1, '{"resources":{"metal":12},"items":[{"item_key":"iron_ore","qty":2}]}',       'smiths_hammer',  2700, 30, NULL, 'superior',  30),
  ('miners_pick',    'Miner''s Pick',  'blacksmith', NULL,          'smithy',   5, 1, '{"resources":{"metal":10,"timber":5}}',                                      'miners_pick',    1800, 22, 'blacksmith.toolsmith', 'superior', 40),
  ('woodsmans_axe',  'Woodsman''s Axe','blacksmith', NULL,          'smithy',   5, 1, '{"resources":{"metal":10,"timber":5}}',                                      'woodsmans_axe',  1800, 22, 'blacksmith.toolsmith', 'superior', 41),
  ('farmers_hoe',    'Farmer''s Hoe',  'blacksmith', NULL,          'smithy',   5, 1, '{"resources":{"metal":8,"timber":6}}',                                       'farmers_hoe',    1800, 20, 'blacksmith.toolsmith', 'superior', 42),
  ('steel_sword',    'Steel Sword',    'blacksmith', 'weaponsmith', 'smithy',  11, 2, '{"resources":{"metal":30},"items":[{"item_key":"iron_ore","qty":3}]}',       'steel_sword',    7200, 80, NULL, 'legendary', 50),
  ('war_hammer',     'War Hammer',     'blacksmith', 'weaponsmith', 'smithy',  13, 2, '{"resources":{"metal":35,"timber":5},"items":[{"item_key":"iron_ore","qty":3}]}', 'war_hammer', 9000, 100, 'blacksmith.steel_mastery', 'legendary', 51),
  ('halberd',        'Halberd',        'blacksmith', 'weaponsmith', 'smithy',  16, 3, '{"resources":{"metal":45,"timber":10},"items":[{"item_key":"iron_ore","qty":4}]}', 'halberd', 12600, 140, 'blacksmith.steel_mastery', 'legendary', 52),
  ('chainmail',      'Chainmail',      'blacksmith', 'armorer',     'smithy',  11, 2, '{"resources":{"metal":30},"items":[{"item_key":"iron_ore","qty":3}]}',       'chainmail',      7200, 80, NULL, 'legendary', 60),
  ('scale_mail',     'Scale Mail',     'blacksmith', 'armorer',     'smithy',  14, 2, '{"resources":{"metal":40},"items":[{"item_key":"iron_ore","qty":4},{"item_key":"hide","qty":2}]}', 'scale_mail', 10800, 120, 'blacksmith.layered_mail', 'legendary', 61),
  ('plate_armour',   'Plate Armour',   'blacksmith', 'armorer',     'smithy',  17, 3, '{"resources":{"metal":60},"items":[{"item_key":"iron_ore","qty":6}]}',       'plate_armour',  14400, 160, 'blacksmith.layered_mail', 'legendary', 62),
  -- Jeweller
  ('silver_ring',    'Silver Ring',    'jeweller',   NULL,          'jeweller', 1, 1, '{"resources":{"metal":6,"wealth":20}}',                                      'silver_ring',    1500, 15, NULL, 'legendary', 10),
  ('jewellers_loupe','Jeweller''s Loupe','jeweller', NULL,          'jeweller', 3, 1, '{"resources":{"metal":8,"timber":2}}',                                       'jewellers_loupe',1800, 20, NULL, 'superior',  20),
  ('scouts_charm',   'Scout''s Charm', 'jeweller',   NULL,          'jeweller', 5, 1, '{"resources":{"metal":6,"wealth":40}}',                                      'scouts_charm',   2400, 30, 'jeweller.settings', 'legendary', 30),
  ('anglers_charm',  'Angler''s Charm','jeweller',   NULL,          'jeweller', 5, 1, '{"resources":{"metal":6,"wealth":40}}',                                      'anglers_charm',  2400, 30, 'jeweller.settings', 'legendary', 31),
  ('cut_gem',        'Cut Gem',        'jeweller',   'gemcutter',   'jeweller',11, 2, '{"items":[{"item_key":"gemstone","qty":1}]}',                                'cut_gem',        3600, 50, NULL, 'basic', 50),
  ('gem_pendant',    'Gem Pendant',    'jeweller',   'gemcutter',   'jeweller',13, 2, '{"resources":{"metal":10,"wealth":50},"items":[{"item_key":"cut_gem","qty":1}]}', 'gem_pendant', 7200, 90, 'jeweller.pendants', 'legendary', 51),
  ('heart_of_the_mountain','Heart of the Mountain','jeweller','gemcutter','jeweller',20,3,'{"resources":{"wealth":200},"items":[{"item_key":"cut_gem","qty":3},{"item_key":"gemstone","qty":2}]}','heart_of_the_mountain',21600,300,'jeweller.heart_of_the_mountain','legendary',52),
  ('gold_ring',      'Gold Ring',      'jeweller',   'goldsmith',   'jeweller',11, 2, '{"resources":{"metal":10,"wealth":80}}',                                     'gold_ring',      3600, 60, NULL, 'legendary', 60),
  ('signet_ring',    'Signet Ring',    'jeweller',   'goldsmith',   'jeweller',14, 2, '{"resources":{"metal":12,"wealth":120}}',                                    'signet_ring',    5400, 90, 'jeweller.signets', 'legendary', 61),
  -- Carpenter
  ('carpenters_plane','Carpenter''s Plane','carpenter',NULL,        'workshop', 1, 1, '{"resources":{"timber":12,"metal":2}}',                                      'carpenters_plane',1200, 15, NULL, 'superior', 10),
  ('fishers_rod',    'Fisher''s Rod',  'carpenter',  NULL,          'workshop', 2, 1, '{"resources":{"timber":10}}',                                                'fishers_rod',    1500, 18, NULL, 'superior', 20),
  ('handcart',       'Handcart',       'carpenter',  NULL,          'workshop', 5, 1, '{"resources":{"timber":30,"metal":5}}',                                      'handcart',       3600, 40, 'carpenter.handcarts', 'superior', 30),
  ('shortbow',       'Shortbow',       'carpenter',  'bowyer',      'workshop',11, 2, '{"resources":{"timber":20},"items":[{"item_key":"rare_sap","qty":1}]}',      'shortbow',       5400, 70, NULL, 'legendary', 50),
  ('longbow',        'Longbow',        'carpenter',  'bowyer',      'workshop',14, 2, '{"resources":{"timber":30},"items":[{"item_key":"rare_sap","qty":2}]}',      'longbow',        9000, 110, 'carpenter.longbows', 'legendary', 51),
  ('heartwood_bow',  'Heartwood Longbow','carpenter','bowyer',      'workshop',20, 3, '{"resources":{"timber":20},"items":[{"item_key":"ancient_heartwood","qty":1},{"item_key":"rare_sap","qty":2}]}', 'heartwood_bow', 14400, 180, 'carpenter.heartwood_longbow', 'legendary', 52),
  ('pack_frame',     'Pack Frame',     'carpenter',  'wainwright',  'workshop',12, 2, '{"resources":{"timber":20},"items":[{"item_key":"hide","qty":1}]}',          'pack_frame',     3600, 60, 'carpenter.pack_frames', 'superior', 60),
  ('caravan_wagon',  'Caravan Wagon',  'carpenter',  'wainwright',  'workshop',15, 3, '{"resources":{"timber":60,"metal":15}}',                                     'caravan_wagon', 10800, 140, 'carpenter.pack_frames', 'superior', 61)
ON CONFLICT (recipe_key) DO NOTHING;
-- ── Crafting finish-up: shields, recipes a town must learn, schematics ──
--   recipes.discovery  'known' (anyone of the class/level can make it) or
--                      'hidden' (the town must learn it first: a crafter
--                      discovers it while working, or someone studies its
--                      schematic).
--   settlement_recipes the hidden recipes each town has learned.
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS discovery TEXT NOT NULL DEFAULT 'known';
DO $$ BEGIN
  ALTER TABLE recipes ADD CONSTRAINT recipes_discovery_chk CHECK (discovery IN ('known','hidden'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS settlement_recipes (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  recipe_key     TEXT NOT NULL,
  source         TEXT NOT NULL CHECK (source IN ('discovery','schematic','admin')),
  citizen_id     INTEGER REFERENCES citizens(id) ON DELETE SET NULL,
  learned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (settlement_id, recipe_key)
);

-- Shields (their own slot) and the hidden recipes' items.
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value, item_effects) VALUES
  ('wooden_buckler', 'Wooden Buckler', 'A small round shield of banded wood.',           '🛡️', 'equipment', 'common',   1, 'basic', 'shield',  '{"combat":1}',   18, '[{"type":"injury","value":-2}]'),
  ('iron_shield',    'Iron Shield',    'Faced with iron, rimmed with steel.',             '🛡️', 'equipment', 'uncommon', 2, 'basic', 'shield',  '{"combat":2}',   50, '[{"type":"injury","value":-4}]'),
  ('tower_shield',   'Tower Shield',   'A wall you can carry.',                           '🧱', 'equipment', 'rare',     3, 'basic', 'shield',  '{"combat":3}',  120, '[{"type":"injury","value":-7}]'),
  ('falchion',       'Falchion',       'A heavy, curved chopping blade.',                 '🗡️', 'equipment', 'rare',     3, 'basic', 'weapon',  '{"combat":5}',   95, NULL),
  ('miners_amulet',  'Miner''s Amulet','A lump of ore set in silver. Miners swear by it.','📿', 'equipment', 'uncommon', 2, 'basic', 'trinket', '{"mining":2}',   45, NULL),
  ('harvest_brooch', 'Harvest Brooch', 'A wheatsheaf in gold wire.',                      '🌾', 'equipment', 'uncommon', 2, 'basic', 'trinket', '{"farming":2}',  45, NULL),
  ('composite_bow',  'Composite Bow',  'Horn, sinew and wood, glued and bound.',          '🏹', 'equipment', 'rare',     3, 'basic', 'weapon',  '{"combat":5}',  110, NULL),
  ('sledge',         'Sledge',         'Runners and a bed: drags far more than it carries.','🛷', 'equipment', 'uncommon', 2, 'basic', 'tool',  '{}',             80, '[{"type":"carry","value":0.2}]')
ON CONFLICT (item_key) DO NOTHING;

INSERT INTO recipes (recipe_key, name, class_key, spec, station, min_level, min_station_level, inputs, output_key, base_seconds, base_xp, unlock_node, quality_cap, sort_order, discovery) VALUES
  ('wooden_buckler', 'Wooden Buckler', 'carpenter',  NULL,          'workshop', 4, 1, '{"resources":{"timber":15,"metal":2}}',                                       'wooden_buckler', 1800,  22, NULL, 'superior',  25, 'known'),
  ('iron_shield',    'Iron Shield',    'blacksmith', 'armorer',     'smithy',  11, 2, '{"resources":{"metal":25,"timber":5},"items":[{"item_key":"iron_ore","qty":2}]}', 'iron_shield', 6000, 70, NULL, 'legendary', 59, 'known'),
  ('tower_shield',   'Tower Shield',   'blacksmith', 'armorer',     'smithy',  15, 3, '{"resources":{"metal":45,"timber":10},"items":[{"item_key":"iron_ore","qty":4},{"item_key":"hide","qty":1}]}', 'tower_shield', 12000, 130, NULL, 'legendary', 63, 'hidden'),
  ('falchion',       'Falchion',       'blacksmith', 'weaponsmith', 'smithy',  14, 2, '{"resources":{"metal":35},"items":[{"item_key":"iron_ore","qty":3}]}',       'falchion',       9000, 110, NULL, 'legendary', 53, 'hidden'),
  ('miners_amulet',  'Miner''s Amulet','jeweller',   NULL,          'jeweller', 6, 1, '{"resources":{"metal":8,"wealth":40},"items":[{"item_key":"iron_ore","qty":1}]}', 'miners_amulet', 2700, 35, NULL, 'legendary', 32, 'hidden'),
  ('harvest_brooch', 'Harvest Brooch', 'jeweller',   NULL,          'jeweller', 6, 1, '{"resources":{"metal":6,"wealth":40}}',                                      'harvest_brooch', 2700,  35, NULL, 'legendary', 33, 'hidden'),
  ('composite_bow',  'Composite Bow',  'carpenter',  'bowyer',      'workshop',16, 3, '{"resources":{"timber":30},"items":[{"item_key":"rare_sap","qty":2},{"item_key":"hide","qty":1}]}', 'composite_bow', 10800, 140, NULL, 'legendary', 52, 'hidden'),
  ('sledge',         'Sledge',         'carpenter',  'wainwright',  'workshop',13, 2, '{"resources":{"timber":40,"metal":8}}',                                      'sledge',         7200,  90, NULL, 'superior',  62, 'hidden')
ON CONFLICT (recipe_key) DO NOTHING;

-- A schematic for every hidden recipe (lib/crafting.js ensureSchematic does
-- the same when Dev Tools hides a recipe). Rarity and value follow the level.
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value)
SELECT 'schematic_' || r.recipe_key, 'Schematic: ' || r.name,
       'Study it and your town''s crafters can make ' || r.name || '.', '📜', 'schematic',
       CASE WHEN r.min_level < 8 THEN 'uncommon' WHEN r.min_level < 14 THEN 'rare' ELSE 'epic' END,
       CASE WHEN r.min_level < 8 THEN 2 WHEN r.min_level < 14 THEN 3 ELSE 4 END,
       'basic', NULL, '{}', 20 + 6 * r.min_level
  FROM recipes r WHERE r.discovery = 'hidden'
ON CONFLICT (item_key) DO NOTHING;
COMMIT;
