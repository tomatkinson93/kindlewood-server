-- R4 group 1: quests, outposts, Watchtower. Idempotent.

-- Time-limited quests: the same gate ids enemies use (lib/time_gates,
-- lib/day_cycle). NULL = any time.
ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS active_phases JSONB;
ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS moon_phases JSONB;

-- Three built-in time-limited tavern quests. Only added to a board that has
-- already been seeded (an empty table means the server still serves its
-- built-in pool, which includes them).
INSERT INTO quest_definitions (id, title, description, icon, category, quest_type, skill_key,
                               base_success, duration_s, reward_gold, flavour_success, flavour_fail,
                               combat_chance, active_phases, moon_phases, quest_source)
SELECT v.* FROM (VALUES
  ('q_night_lanterns', 'Lantern Watch', 'Something prowls the lanes after dark. Walk the lantern route until dawn.',
   '🏮', 'combat', 'solo', 'combat', 0.5::float, 150, 14,
   'walks the last lantern home at dawn. The lanes are quiet again.', 'ran from a shape in the dark and lost the lantern on the way.',
   40, '["dusk","night"]'::jsonb, NULL::jsonb, 'tavern'),
  ('q_night_moths', 'Catch Glowmoths', 'Glowmoths only rise at night. The apothecary pays well for a jarful.',
   '🦋', 'gathering', 'solo', 'farming', 0.55::float, 120, 12,
   'comes back with a jar of softly glowing moths.', 'chased lights all night and caught only a cold.',
   0, '["night"]'::jsonb, NULL::jsonb, 'tavern'),
  ('q_full_moon_pool', 'The Moonlit Pool', 'On the night of a full moon, the old pool is said to show where things were lost.',
   '🌕', 'exploration', 'solo', 'scouting', 0.45::float, 180, 30,
   'stares into the silver water and finds an old coin purse on the bank.', 'saw only their own face, tired and wet.',
   0, NULL::jsonb, '["full"]'::jsonb, 'tavern')
) AS v(id, title, description, icon, category, quest_type, skill_key, base_success, duration_s, reward_gold,
       flavour_success, flavour_fail, combat_chance, active_phases, moon_phases, quest_source)
WHERE EXISTS (SELECT 1 FROM quest_definitions q WHERE COALESCE(q.quest_source, 'tavern') = 'tavern'
                AND q.id NOT IN ('q_night_lanterns', 'q_night_moths', 'q_full_moon_pool'))
ON CONFLICT (id) DO NOTHING;

-- Outposts: the food upkeep went unpaid (famine.js) → outposts at half yield.
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS outposts_unfed_since TIMESTAMPTZ;
