-- Tactics battles (docs/TACTICS.md §9, Phase 2). Idempotent: re-run on every boot.
--
-- tactics_battles  one row per battle on a board. `setup` is the two sides as
--                  they stood when it began (frozen, so a replay never
--                  changes); `actions` is what the player chose, in order.
--                  The battle itself is never stored: the server gets it back
--                  by playing the choices again (lib/tactics_engine.js).
--                  `source` says what it was fought for: 'practice' (from
--                  Dev Tools) for now; dungeon rooms and quests later.

CREATE TABLE IF NOT EXISTS tactics_battles (
  id             BIGSERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL,
  source         TEXT NOT NULL DEFAULT 'practice',
  seed           BIGINT NOT NULL,
  land           TEXT NOT NULL,
  tier           TEXT NOT NULL,
  fight          TEXT NOT NULL DEFAULT 'fight',
  setup          JSONB NOT NULL,
  actions        JSONB NOT NULL DEFAULT '[]'::jsonb,
  status         TEXT NOT NULL DEFAULT 'active',     -- active | victory | defeat | left
  result         JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMPTZ
);
-- A town has one battle on a board at a time.
-- (The first rule, one open battle of any kind a town, was tactics_battles_one_active; see the end of this file.)
CREATE INDEX IF NOT EXISTS tactics_battles_by_town ON tactics_battles (settlement_id, id DESC);

-- Dungeons on the board (docs/TACTICS.md §9, Phase 3). A run is fought with
-- cards ('cards', as before) or on the board ('board'). A board run's open
-- fight is a tactics battle (board_battle_id) that names its run.
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS combat TEXT NOT NULL DEFAULT 'cards';
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS board_battle_id BIGINT;
ALTER TABLE tactics_battles ADD COLUMN IF NOT EXISTS dungeon_run_id INTEGER;

-- Fights with cards were retired from dungeons on 2026-11-23 (docs/TACTICS.md §8). A run that was begun the old
-- way (only ever from Dev Tools) cannot go on: it is closed as "left", and its open card battle with it.
UPDATE dungeon_runs SET status = 'left', room_open = FALSE, battle_run_id = NULL, ended_at = COALESCE(ended_at, NOW())
 WHERE status IN ('travelling', 'active') AND COALESCE(combat, 'cards') <> 'board';
UPDATE settlement_quests SET status = 'collected', combat_status = 'resolved', combat_outcome = 'defeat', combat_resolved_at = NOW(), completes_at = NOW()
 WHERE quest_id = 'dungeon_room' AND status = 'active';

-- Readying (docs/TACTICS.md §6): which of the abilities a citizen knows they
-- bring to a battle, as a list of ability keys. NULL: the first five learned.
ALTER TABLE citizen_classes ADD COLUMN IF NOT EXISTS ready JSONB;

-- The second school (lib/tactics_setup.js; docs/TACTICS.md §6, 2026-11-26). A
-- citizen brings everything their current class has taught them, and up to
-- five abilities from one other class they have levels in. second_class: that
-- class ('none': bring nothing; NULL: the one they are furthest along in);
-- second_ready: which of its abilities (NULL: the first five it taught).
-- citizen_classes.ready (five chosen from one's own class) is no longer read.
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS second_class TEXT;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS second_ready JSONB;

-- Mastery (lib/tactics_mastery.js): how many times each citizen has used each
-- ability in a kept battle. At 25 it is mastered (✦) for them, for good.
CREATE TABLE IF NOT EXISTS citizen_ability_uses (
  citizen_id  INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  ability_key TEXT NOT NULL,
  uses        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (citizen_id, ability_key)
);

-- Quest battles on the board (docs/TACTICS.md §8 step 3; lib/tactics_quests.js): a battle that names the quest run
-- it is fought for. A town may have one of these open for each quest that is waiting on a fight, beside its one
-- dungeon or practice battle, so the "one open battle a town" rule now leaves them out.
ALTER TABLE tactics_battles ADD COLUMN IF NOT EXISTS quest_run_id INTEGER;
DROP INDEX IF EXISTS tactics_battles_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS tactics_battles_one_open ON tactics_battles (settlement_id) WHERE status = 'active' AND source <> 'quest';
CREATE UNIQUE INDEX IF NOT EXISTS tactics_battles_one_per_quest ON tactics_battles (quest_run_id) WHERE status = 'active' AND quest_run_id IS NOT NULL;

-- Staffs (lib/gear_kinds.js; docs/TACTICS.md §6 stage C): the weapon of a
-- Wizard or a Hearthkeeper. Wild and Hearth magic is a fifth stronger in the
-- hands of whoever carries one. A carpenter makes them. Only added if
-- missing, so Dev Tools edits survive.
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value, armor_class, item_effects) VALUES
  ('oak_staff',       'Oak Staff',       'A straight length of seasoned oak. Magic runs truer along it.', '🪄', 'equipment', 'common',    1, 'basic', 'weapon', '{"combat":1}',  30, NULL, NULL),
  ('rowan_staff',     'Rowan Staff',     'Rowan keeps its own counsel, and a spell''s.',                   '🪄', 'equipment', 'uncommon',  2, 'basic', 'weapon', '{"combat":3}',  75, NULL, NULL),
  ('heartwood_staff', 'Heartwood Staff', 'Cut from the heart of an ancient tree, and still warm.',         '🌿', 'equipment', 'legendary', 5, 'basic', 'weapon', '{"combat":5}', 300, NULL, NULL)
ON CONFLICT (item_key) DO NOTHING;
INSERT INTO recipes (recipe_key, name, class_key, spec, station, min_level, min_station_level, inputs, output_key, base_seconds, base_xp, unlock_node, quality_cap, sort_order) VALUES
  ('oak_staff',       'Oak Staff',       'carpenter', NULL, 'workshop',  3, 1, '{"resources":{"timber":14}}',                                                                                         'oak_staff',        1800,  22, NULL, 'legendary', 26),
  ('rowan_staff',     'Rowan Staff',     'carpenter', NULL, 'workshop', 10, 2, '{"resources":{"timber":24},"items":[{"item_key":"rare_sap","qty":1}]}',                                               'rowan_staff',      6000,  80, NULL, 'legendary', 27),
  ('heartwood_staff', 'Heartwood Staff', 'carpenter', NULL, 'workshop', 18, 3, '{"resources":{"timber":20},"items":[{"item_key":"ancient_heartwood","qty":1},{"item_key":"rare_sap","qty":2}]}',     'heartwood_staff', 14400, 180, NULL, 'legendary', 28)
ON CONFLICT (recipe_key) DO NOTHING;

-- Ember lanterns (lib/gear_kinds.js; the owner, 2026-11-27): a Hearthkeeper's
-- own implement, a coal from the town's hearth carried in a lantern. Hearth
-- magic is a fifth stronger in the hands of whoever carries one, and it takes
-- one hand, so a shield goes with it. A staff is now the Wizard's alone
-- (Wild magic). A blacksmith makes lanterns at the smithy.
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value, armor_class, item_effects) VALUES
  ('ember_lantern',       'Ember Lantern',       'A coal from the town''s hearth, carried behind horn panes.',     '🏮', 'equipment', 'common',    1, 'basic', 'weapon', '{"combat":1}',  30, NULL, NULL),
  ('brass_lantern',       'Brass Hearth-lantern','Brass keeps the coal warm through a long night''s walk.',        '🏮', 'equipment', 'uncommon',  2, 'basic', 'weapon', '{"combat":3}',  75, NULL, NULL),
  ('everburning_lantern', 'Everburning Lantern', 'Its ember was lit before the town was, and has never gone out.', '🔥', 'equipment', 'legendary', 5, 'basic', 'weapon', '{"combat":5}', 300, NULL, NULL)
ON CONFLICT (item_key) DO NOTHING;
INSERT INTO recipes (recipe_key, name, class_key, spec, station, min_level, min_station_level, inputs, output_key, base_seconds, base_xp, unlock_node, quality_cap, sort_order) VALUES
  ('ember_lantern',       'Ember Lantern',        'blacksmith', NULL, 'smithy',  3, 1, '{"resources":{"metal":10,"timber":4}}',                                                                             'ember_lantern',        1800,  22, NULL, 'legendary', 26),
  ('brass_lantern',       'Brass Hearth-lantern', 'blacksmith', NULL, 'smithy', 10, 2, '{"resources":{"metal":22,"timber":4},"items":[{"item_key":"iron_ore","qty":2}]}',                                   'brass_lantern',        6000,  80, NULL, 'legendary', 27),
  ('everburning_lantern', 'Everburning Lantern',  'blacksmith', NULL, 'smithy', 18, 3, '{"resources":{"metal":30},"items":[{"item_key":"ancient_heartwood","qty":1},{"item_key":"rare_sap","qty":2}]}',   'everburning_lantern', 14400, 180, NULL, 'legendary', 28)
ON CONFLICT (recipe_key) DO NOTHING;

-- Study at a class building, and the passive slot (lib/tactics_study.js;
-- docs/TACTICS.md §6 stage D). citizen_lessons: what a citizen has learned by
-- study (extra abilities and passives), for good. citizen_study: the one
-- lesson a citizen is studying now; a row is a seat at that building.
-- citizens.passive: the passive in their one slot ('none': chosen to have none).
CREATE TABLE IF NOT EXISTS citizen_lessons (
  citizen_id INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  lesson_key TEXT NOT NULL,
  learned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (citizen_id, lesson_key)
);
CREATE TABLE IF NOT EXISTS citizen_study (
  citizen_id    INTEGER PRIMARY KEY REFERENCES citizens(id) ON DELETE CASCADE,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  lesson_key    TEXT NOT NULL,
  building      TEXT NOT NULL,
  wealth        INTEGER NOT NULL DEFAULT 0,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at       TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citizen_study_done ON citizen_study (done_at);
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS passive TEXT;
