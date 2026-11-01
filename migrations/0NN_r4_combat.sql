-- R4 group 2: enemies that belong to the land, saved loot, card collection.
-- Idempotent.

-- The enemy editor (routes/combat.js) writes these; a fresh database never
-- had them. biomes: terrain ids (outposts_config / tiles.terrain) where a
-- RANDOM pick may choose this enemy; NULL = anywhere (lib/time_gates).
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS moves JSONB DEFAULT '[]';
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS move_mode TEXT DEFAULT 'sequence';
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS hp_min INTEGER;
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS hp_max INTEGER;
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS drops JSONB DEFAULT '[]';
ALTER TABLE enemy_definitions ADD COLUMN IF NOT EXISTS biomes JSONB;

-- The three stock creatures (the engine's built-in roster), so the table is
-- never just the new arrivals.
INSERT INTO enemy_definitions (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order, biomes, drops)
VALUES
  ('marsh_rat',   'Marsh Rat',   '🐀', 'A scrappy biter, quick on its feet.',        22, 5, 9,  4, 2, 'bites',      1, 10, '["marsh","river","plains"]', '[{"item":"hide","chance":0.25,"min":1,"max":1}]'),
  ('wild_fox',    'Wild Fox',    '🦊', 'Cunning. Will harry the weakest.',           30, 7, 11, 5, 3, 'lunges at',  2, 20, '["forest","plains","hills"]', '[{"item":"hide","chance":0.4,"min":1,"max":2}]'),
  ('fungal_toad', 'Fungal Toad', '🐸', 'Slow and bloated, but surprisingly tough.',  42, 8, 4,  9, 2, 'slams into', 3, 30, '["marsh","forest"]', '[{"item":"rare_sap","chance":0.2,"min":1,"max":1}]')
ON CONFLICT (id) DO NOTHING;
UPDATE enemy_definitions SET biomes = '["marsh","river","plains"]' WHERE id = 'marsh_rat' AND biomes IS NULL;
UPDATE enemy_definitions SET biomes = '["forest","plains","hills"]' WHERE id = 'wild_fox' AND biomes IS NULL;
UPDATE enemy_definitions SET biomes = '["marsh","forest"]' WHERE id = 'fungal_toad' AND biomes IS NULL;

-- Eight creatures of the land, each with a move list (lib/card_formula).
INSERT INTO enemy_definitions (id, name, icon, flavour, max_hp, strength, agility, endurance, combat_skill, attack_verb, reward_weight, sort_order,
                               biomes, moves, move_mode, drops, active_phases)
VALUES
  ('bog_lurker', 'Bog Lurker', '🦎', 'It waits under the green water. Its bite festers.', 34, 7, 7, 6, 3, 'bites', 2, 40,
   '["marsh","river"]',
   '[{"key":"bite","name":"Bite","formula":"damage: strength*0.8 + 2","target":"enemy","hit":"choose","intent":"attack","weight":2},
     {"key":"venom","name":"Venom Spit","formula":"damage: 2\npoison: 3","target":"enemy","hit":"choose","intent":"debuff","weight":1}]',
   'sequence', '[{"item":"blightbane_herb","chance":0.12,"min":1,"max":1},{"item":"hide","chance":0.3,"min":1,"max":1}]', NULL),
  ('hill_ogre', 'Hill Ogre', '👹', 'Big, slow and very fond of its club.', 60, 11, 3, 10, 3, 'clubs', 4, 50,
   '["hills"]',
   '[{"key":"club","name":"Club","formula":"damage: strength*0.9 + 2","target":"enemy","hit":"front","intent":"attack","weight":2},
     {"key":"slam","name":"Ground Slam","formula":"damage: strength*0.5\nstun: 1","target":"enemy","hit":"front","intent":"special","weight":1}]',
   'sequence', '[{"item":"ancient_coin","chance":0.15,"min":1,"max":1},{"item":"gemstone","chance":0.08,"min":1,"max":1}]', NULL),
  ('mountain_harpy', 'Mountain Harpy', '🦅', 'A shriek on the wind, then talons.', 32, 7, 12, 4, 4, 'rakes', 3, 60,
   '["mountain","hills"]',
   '[{"key":"rake","name":"Rake","formula":"damage: agility*0.6 + 2","target":"enemy","hit":"choose","intent":"attack","weight":2},
     {"key":"shriek","name":"Shriek","formula":"debuff weak: 3","target":"all_enemies","hit":"aoe","intent":"debuff","weight":1}]',
   'sequence', '[{"item":"luminous_scale","chance":0.1,"min":1,"max":1}]', NULL),
  ('thornback_boar', 'Thornback Boar', '🐗', 'Bristles like brambles; charges like a landslide.', 44, 9, 6, 9, 3, 'gores', 3, 70,
   '["forest","plains"]',
   '[{"key":"bristle","name":"Bristle","formula":"block: endurance*1 + 3","target":"self","hit":"choose","intent":"block","weight":1},
     {"key":"charge","name":"Charge","formula":"damage: strength*1.2 + 3","target":"enemy","hit":"front","intent":"attack","weight":2}]',
   'sequence', '[{"item":"hide","chance":0.6,"min":1,"max":2},{"item":"timber_bundle","chance":0.15,"min":1,"max":1}]', NULL),
  ('river_pike', 'River Pike', '🐟', 'A mouthful of needles in the reeds.', 28, 8, 9, 5, 3, 'snaps at', 2, 80,
   '["river","marsh"]',
   '[{"key":"snap","name":"Snap","formula":"damage: strength*0.7 + 2","target":"enemy","hit":"choose","intent":"attack","weight":2},
     {"key":"drag","name":"Drag Under","formula":"damage: strength*0.4\ndebuff vulnerable: 2","target":"enemy","hit":"choose","intent":"debuff","weight":1}]',
   'sequence', '[{"item":"luminous_scale","chance":0.06,"min":1,"max":1}]', NULL),
  ('withered_husk', 'Withered Husk', '🧟', 'What the blight leaves behind still walks.', 38, 8, 5, 8, 3, 'claws', 3, 90,
   '["ruins","marsh"]',
   '[{"key":"claw","name":"Claw","formula":"damage: strength*0.8 + 2","target":"enemy","hit":"choose","intent":"attack","weight":2},
     {"key":"rot","name":"Rotting Touch","formula":"debuff vulnerable: 3","target":"enemy","hit":"choose","intent":"debuff","weight":1}]',
   'sequence', '[{"item":"blightbane_herb","chance":0.15,"min":1,"max":1},{"item":"ancient_coin","chance":0.1,"min":1,"max":1}]', NULL),
  ('rot_shaman', 'Rot Shaman', '🧙', 'Mutters over its kin and they stand back up.', 30, 5, 6, 6, 4, 'hexes', 4, 100,
   '["ruins"]',
   '[{"key":"hex","name":"Hex","formula":"damage: intelligence*0.6 + 3","target":"enemy","hit":"choose","intent":"attack","weight":2},
     {"key":"mend","name":"Dark Mend","formula":"heal: 6","target":"ally","hit":"choose","intent":"buff","weight":1}]',
   'sequence', '[{"item":"ancient_blueprint","chance":0.03,"min":1,"max":1},{"item":"blightbane_herb","chance":0.2,"min":1,"max":1}]', NULL),
  ('night_wolf', 'Night Wolf', '🐺', 'They hunt in packs under the moon.', 34, 8, 10, 6, 4, 'bites', 3, 110,
   '["forest","plains","hills"]',
   '[{"key":"bite","name":"Bite","formula":"damage: strength*0.8 + 2","target":"enemy","hit":"choose","intent":"attack","weight":2},
     {"key":"howl","name":"Pack Howl","formula":"damage: strength*0.4 + 1","target":"all_enemies","hit":"aoe","intent":"attack","weight":1}]',
   'sequence', '[{"item":"hide","chance":0.5,"min":1,"max":2}]', '["dusk","night"]')
ON CONFLICT (id) DO NOTHING;

-- Card collection (settlement_unlocked_cards, 0NN_cards.sql): the starter
-- cards are owned implicitly (lib/cards.js); rows record each unlock.
ALTER TABLE settlement_unlocked_cards ADD COLUMN IF NOT EXISTS source TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ux_unlocked_cards ON settlement_unlocked_cards (settlement_id, card_key);
