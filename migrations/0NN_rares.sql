-- 0NN_rares.sql — things to make from the rare materials (obsidian,
-- moonsilver, mithril, gems, gold ore), and uses for items that were only
-- ever sold. Rename 0NN to the next free migration number at deploy time;
-- db.js initDB() re-applies it on every boot (matched by `_rares.sql`), so
-- every statement is idempotent. Runs after 0NN_smelter.sql (recipes.research).
--
-- Each recipe needs the research that reveals its material. The mithril and
-- moonsilver masterpieces are hidden (level 14+), so their schematics are
-- epic — only Allied villages sell them (lib/npc_trade.js SCHEMATIC_TIER).
BEGIN;
-- The found items the new recipes use (item_seed.js has them too; a fresh
-- database may not have run it).
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value) VALUES
  ('timber_bundle',     'Timber Bundle',     'Split and bound, ready to work.',             '🪵', 'material',   'common', 1, 'basic', NULL, '{}', 5),
  ('wool',              'Wool',              'A fleece of soft wool, ready for spinning.',  '🧶', 'material',   'common', 1, 'basic', NULL, '{}', 6),
  ('luminous_scale',    'Luminous Scale',    'A scale that holds the moonlight.',           '✨', 'quest_item', 'rare',   3, 'basic', NULL, '{}', 40),
  ('ancient_blueprint', 'Ancient Blueprint', 'Plans for something vast, long forgotten.',   '📜', 'quest_item', 'epic',   4, 'basic', NULL, '{}', 80),
  ('blightbane_herb',   'Blightbane Herb',   'A bitter herb that draws out sickness.',      '🌿', 'material',   'rare',   3, 'basic', NULL, '{}', 35),
  ('ancient_coin',      'Ancient Coin',      'Stamped with a king no one remembers.',       '🪙', 'trophy',     'rare',   3, 'basic', NULL, '{}', 40)
ON CONFLICT (item_key) DO NOTHING;

INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value, armor_class, item_effects, damage_dice, damage_bonus) VALUES
  ('obsidian_blade',     'Obsidian Blade',     'Volcanic glass, knapped to an edge sharper than steel.', '🗡️', 'equipment', 'rare',     3, 'basic', 'weapon',  '{"combat":5}',                  140, NULL, NULL, '1d8', 1),
  ('obsidian_axe',       'Obsidian Axe',       'A black-glass bit on an ash haft. Bites deep.',          '🪓', 'equipment', 'uncommon', 2, 'basic', 'tool',    '{"woodcutting":3}',              90, NULL, NULL, NULL, 0),
  ('mithril_blade',      'Mithril Blade',      'Light as a reed, and it never dulls.',                   '⚔️', 'equipment', 'epic',     4, 'basic', 'weapon',  '{"combat":7}',                  320, NULL, NULL, '1d10', 2),
  ('mithril_mail',       'Mithril Mail',       'Rings of starmetal, fine as cloth.',                     '🛡️', 'equipment', 'epic',     4, 'basic', 'armour',  '{"combat":5}',                  360, 8,    NULL, NULL, 0),
  ('moonsilver_charm',   'Moonsilver Charm',   'A crescent that glows faintly in the dark.',             '🌙', 'equipment', 'rare',     3, 'basic', 'trinket', '{"scouting":2,"fishing":2}',    150, NULL, '[{"type":"mood","value":3}]', NULL, 0),
  ('moonsilver_circlet', 'Moonsilver Circlet', 'Worn by masters; steadies the hand.',                    '👑', 'equipment', 'epic',     4, 'basic', 'trinket', '{"crafting":3}',                300, NULL, '[{"type":"quality","value":1}]', NULL, 0),
  ('gemset_ring',        'Gem-set Ring',       'Gold, and a stone that catches every light.',            '💍', 'equipment', 'rare',     3, 'basic', 'trinket', '{"mining":2,"combat":1}',       170, NULL, NULL, NULL, 0),
  ('gilded_crown',       'Gilded Crown',       'Gold and gems around an ancient coin. Fit for a ruler.', '👑', 'equipment', 'epic',     4, 'basic', 'trinket', '{"crafting":2,"scouting":1}',   420, NULL, '[{"type":"mood","value":6}]', NULL, 0),
  ('gold_chalice',       'Gold Chalice',       'A heavy cup of beaten gold. Collectors pay well.',       '🏆', 'trophy',    'rare',     3, 'basic', NULL,      '{}',                            220, NULL, NULL, NULL, 0),
  ('healers_satchel',    'Healer''s Satchel',  'Blightbane poultices, ready for the wounded.',           '🌿', 'equipment', 'rare',     3, 'basic', 'trinket', '{}',                            110, NULL, '[{"type":"injury","value":-5}]', NULL, 0)
ON CONFLICT (item_key) DO NOTHING;

INSERT INTO recipes (recipe_key, name, class_key, spec, station, min_level, min_station_level, inputs, output_key, output_qty, base_seconds, base_xp, unlock_node, quality_cap, sort_order, discovery, research) VALUES
  ('obsidian_blade',     'Obsidian Blade',     'blacksmith', NULL, 'smithy',   12, 2, '{"resources":{"obsidian":4,"steel":4}}',                                            'obsidian_blade',     1,  9000, 110, NULL, 'legendary', 70, 'known',  'volcanic_lore'),
  ('mithril_blade',      'Mithril Blade',      'blacksmith', NULL, 'smithy',   16, 3, '{"resources":{"mithril":3,"steel":6}}',                                             'mithril_blade',      1, 14400, 170, NULL, 'legendary', 72, 'hidden', 'starmetal'),
  ('mithril_mail',       'Mithril Mail',       'blacksmith', NULL, 'smithy',   17, 3, '{"resources":{"mithril":4,"steel":8}}',                                             'mithril_mail',       1, 16200, 190, NULL, 'legendary', 73, 'hidden', 'starmetal'),
  ('obsidian_axe',       'Obsidian Axe',       'carpenter',  NULL, 'workshop', 10, 2, '{"resources":{"obsidian":3,"metal":6},"items":[{"item_key":"timber_bundle","qty":2}]}', 'obsidian_axe', 1,  6000,  80, NULL, 'legendary', 70, 'known',  'volcanic_lore'),
  ('healers_satchel',    'Healer''s Satchel',  'carpenter',  NULL, 'workshop',  8, 1, '{"resources":{"timber":6},"items":[{"item_key":"blightbane_herb","qty":2}]}',      'healers_satchel',    1,  4200,  55, NULL, 'superior',  71, 'known',  NULL),
  ('moonsilver_charm',   'Moonsilver Charm',   'jeweller',   NULL, 'jeweller', 12, 2, '{"resources":{"moonsilver":2,"silver":2},"items":[{"item_key":"luminous_scale","qty":1}]}', 'moonsilver_charm', 1, 7200, 100, NULL, 'legendary', 70, 'known', 'moon_lore'),
  ('moonsilver_circlet', 'Moonsilver Circlet', 'jeweller',   NULL, 'jeweller', 15, 3, '{"resources":{"moonsilver":4,"silver":3},"items":[{"item_key":"wool","qty":2}]}',  'moonsilver_circlet', 1, 12600, 160, NULL, 'legendary', 71, 'hidden', 'moon_lore'),
  ('gemset_ring',        'Gem-set Ring',       'jeweller',   NULL, 'jeweller', 12, 2, '{"resources":{"gems":3,"goldore":2}}',                                              'gemset_ring',        1,  6600,  95, NULL, 'legendary', 72, 'known',  'deep_veins'),
  ('gilded_crown',       'Gilded Crown',       'jeweller',   NULL, 'jeweller', 16, 3, '{"resources":{"goldore":6,"gems":4,"silver":2},"items":[{"item_key":"ancient_coin","qty":2}]}', 'gilded_crown', 1, 14400, 180, NULL, 'legendary', 73, 'hidden', 'deep_veins'),
  ('gold_chalice',       'Gold Chalice',       'jeweller',   NULL, 'jeweller', 10, 2, '{"resources":{"goldore":4,"silver":2}}',                                            'gold_chalice',       1,  5400,  75, NULL, 'basic',     74, 'known',  'deep_veins'),
  ('gold_ingots',        'Gold Ingots',        'smelter',    NULL, 'smelter',   8, 2, '{"resources":{"goldore":3,"coal":1}}',                                              'wealth',            60,  1800,  25, NULL, 'basic',     50, 'known',  'deep_veins')
ON CONFLICT (recipe_key) DO NOTHING;

-- Schematics for the new hidden recipes (same rule as 0NN_crafting.sql).
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value)
SELECT 'schematic_' || r.recipe_key, 'Schematic: ' || r.name,
       'Study it and your town''s crafters can make ' || r.name || '.', '📜', 'schematic',
       CASE WHEN r.min_level < 8 THEN 'uncommon' WHEN r.min_level < 14 THEN 'rare' ELSE 'epic' END,
       CASE WHEN r.min_level < 8 THEN 2 WHEN r.min_level < 14 THEN 3 ELSE 4 END,
       'basic', NULL, '{}', 20 + 6 * r.min_level
  FROM recipes r WHERE r.discovery = 'hidden'
ON CONFLICT (item_key) DO NOTHING;

-- The Gold Ring did nothing but sell. Now it lifts its wearer's mood
-- (only while it's still bonus-less: Dev Tools edits are kept).
UPDATE item_templates SET item_effects = '[{"type":"mood","value":4}]'::jsonb
 WHERE item_key = 'gold_ring' AND COALESCE(stat_bonuses, '{}'::jsonb) = '{}'::jsonb
   AND (item_effects IS NULL OR item_effects = '[]'::jsonb OR item_effects = 'null'::jsonb);
COMMIT;
