-- 0NN_smelter.sql — the Smelter's recipes, research-gated recipes, and the
-- advanced recipes switching to the new metals.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_smelter.sql`), so
-- every statement is idempotent. Runs after 0NN_crafting.sql and
-- 0NN_resources.sql.
--
--   recipes.research   a research project (lib/research_defs.js) the town
--                      must finish first, or NULL
--   A recipe whose output_key is a resource (lib/resource_defs.js) puts
--   that resource in the stores instead of an item (lib/crafting.js).
BEGIN;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS research TEXT;

INSERT INTO recipes (recipe_key, name, class_key, spec, station, min_level, min_station_level, inputs, output_key, output_qty, base_seconds, base_xp, unlock_node, quality_cap, sort_order, discovery, research) VALUES
  ('bronze',         'Bronze',         'smelter', NULL,          'smelter',  1, 1, '{"resources":{"copper":2,"tin":1}}',            'bronze', 2,  900, 12, NULL,                  'basic', 10, 'known', 'smelting'),
  ('steel',          'Steel',          'smelter', NULL,          'smelter',  3, 1, '{"resources":{"metal":2,"coal":1}}',            'steel',  1, 1200, 16, NULL,                  'basic', 20, 'known', 'steelworking'),
  ('bronze_batch',   'Bronze Batch',   'smelter', 'bronzesmith', 'smelter', 11, 2, '{"resources":{"copper":6,"tin":3,"coal":1}}',   'bronze', 8, 2400, 45, 'smelter.bell_metal',  'basic', 30, 'known', 'smelting'),
  ('crucible_steel', 'Crucible Steel', 'smelter', 'steelmaker',  'smelter', 11, 2, '{"resources":{"metal":6,"coal":2}}',            'steel',  4, 2700, 50, 'smelter.crucibles',   'basic', 40, 'known', 'steelworking')
ON CONFLICT (recipe_key) DO NOTHING;

-- Advanced recipes use the new metals — once, and only where a recipe still
-- has its original inputs (a Dev Tools edit is never overwritten).
CREATE TABLE IF NOT EXISTS migration_marks (
  key      TEXT PRIMARY KEY,
  done_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $metals$
BEGIN
IF NOT EXISTS (SELECT 1 FROM migration_marks WHERE key = 'recipes_metals_v1') THEN
  UPDATE recipes r SET inputs = v.new_inputs::jsonb, updated_at = NOW()
    FROM (VALUES
      ('steel_sword',  '{"resources":{"metal":30},"items":[{"item_key":"iron_ore","qty":3}]}',
                       '{"resources":{"metal":10,"steel":8},"items":[{"item_key":"iron_ore","qty":1}]}'),
      ('war_hammer',   '{"resources":{"metal":35,"timber":5},"items":[{"item_key":"iron_ore","qty":3}]}',
                       '{"resources":{"metal":10,"steel":10,"timber":5},"items":[]}'),
      ('halberd',      '{"resources":{"metal":45,"timber":10},"items":[{"item_key":"iron_ore","qty":4}]}',
                       '{"resources":{"metal":15,"steel":14,"timber":10},"items":[]}'),
      ('plate_armour', '{"resources":{"metal":60},"items":[{"item_key":"iron_ore","qty":6}]}',
                       '{"resources":{"metal":20,"steel":18},"items":[]}'),
      ('scale_mail',   '{"resources":{"metal":40},"items":[{"item_key":"iron_ore","qty":4},{"item_key":"hide","qty":2}]}',
                       '{"resources":{"metal":20,"bronze":10},"items":[{"item_key":"hide","qty":2}]}'),
      ('tower_shield', '{"resources":{"metal":45,"timber":10},"items":[{"item_key":"iron_ore","qty":4},{"item_key":"hide","qty":1}]}',
                       '{"resources":{"metal":15,"steel":12,"timber":10},"items":[{"item_key":"hide","qty":1}]}'),
      ('falchion',     '{"resources":{"metal":35},"items":[{"item_key":"iron_ore","qty":3}]}',
                       '{"resources":{"metal":15,"steel":8},"items":[]}'),
      ('caravan_wagon','{"resources":{"timber":60,"metal":15}}',
                       '{"resources":{"timber":60,"metal":5,"bronze":6}}'),
      ('cut_gem',      '{"items":[{"item_key":"gemstone","qty":1}]}',
                       '{"resources":{"gems":2},"items":[]}'),
      ('gem_pendant',  '{"resources":{"metal":10,"wealth":50},"items":[{"item_key":"cut_gem","qty":1}]}',
                       '{"resources":{"silver":3,"wealth":40},"items":[{"item_key":"cut_gem","qty":1}]}'),
      ('heart_of_the_mountain', '{"resources":{"wealth":200},"items":[{"item_key":"cut_gem","qty":3},{"item_key":"gemstone","qty":2}]}',
                       '{"resources":{"wealth":150,"gems":4,"mithril":2},"items":[{"item_key":"cut_gem","qty":3}]}'),
      ('gold_ring',    '{"resources":{"metal":10,"wealth":80}}',
                       '{"resources":{"goldore":3,"wealth":40}}'),
      ('signet_ring',  '{"resources":{"metal":12,"wealth":120}}',
                       '{"resources":{"goldore":4,"silver":2,"wealth":60}}'),
      ('miners_amulet','{"resources":{"metal":8,"wealth":40},"items":[{"item_key":"iron_ore","qty":1}]}',
                       '{"resources":{"silver":2,"wealth":30},"items":[{"item_key":"iron_ore","qty":1}]}')
    ) AS v(recipe_key, old_inputs, new_inputs)
   WHERE r.recipe_key = v.recipe_key AND r.inputs = v.old_inputs::jsonb;
  INSERT INTO migration_marks (key) VALUES ('recipes_metals_v1');
END IF;
END
$metals$;
COMMIT;
