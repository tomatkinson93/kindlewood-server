-- Dungeons (docs/DUNGEONS.md §9.1). Idempotent: re-run on every boot.
--
-- dungeons      one row per dungeon. `source` is 'map', 'quest' or 'test'
--               (a hand-written story started from Dev Tools). A story
--               dungeon names its definition in `story_key`
--               (lib/dungeon_defs.js); a generated one is rebuilt from `seed`.
-- dungeon_runs  one row per town per dungeon: the party, where it stands,
--               each citizen's health and who is down, the loot held until
--               the run ends, and how it ended.

CREATE TABLE IF NOT EXISTS dungeons (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL DEFAULT 'map',
  q           INTEGER,
  r           INTEGER,
  terrain     TEXT,
  tier        TEXT NOT NULL DEFAULT 'green',
  seed        INTEGER NOT NULL DEFAULT 1,
  story_key   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS dungeon_runs (
  id             SERIAL PRIMARY KEY,
  dungeon_id     INTEGER NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  user_id        INTEGER NOT NULL,
  party_ids      JSONB NOT NULL DEFAULT '[]',
  -- active | cleared | left | fled | defeat | timed_out  ('travelling' comes with map dungeons)
  status         TEXT NOT NULL DEFAULT 'active',
  floor          INTEGER NOT NULL DEFAULT 0,
  room           TEXT,                         -- the room the party stands in; NULL at the door of a floor
  room_open      BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE while that room still wants a fight or an answer
  path_taken     JSONB NOT NULL DEFAULT '[]',
  party_state    JSONB NOT NULL DEFAULT '{}',  -- { citizenId: { hp, max, down, was_down } }
  deck           JSONB,                        -- the drafted deck (build step 5)
  draft          JSONB,
  effects        JSONB NOT NULL DEFAULT '[]',  -- blessings, curses, keepsakes (build step 6)
  pack           JSONB NOT NULL DEFAULT '[]',  -- supplies (build step 9)
  loot           JSONB NOT NULL DEFAULT '{}',  -- { wealth, items: [{ item, qty }] } held until the run ends
  battle_run_id  INTEGER,                      -- the settlement_quests row of the open fight
  last_enemy     TEXT,                         -- for injury lines when the run ends outside a fight
  result         JSONB,                        -- written once, when the run ends
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at       TIMESTAMPTZ,
  UNIQUE (dungeon_id, settlement_id)
);
-- At most one unfinished run per town.
CREATE UNIQUE INDEX IF NOT EXISTS idx_dungeon_runs_one_live ON dungeon_runs (settlement_id) WHERE status IN ('travelling', 'active');
CREATE INDEX IF NOT EXISTS idx_dungeon_runs_idle ON dungeon_runs (last_action_at) WHERE status IN ('travelling', 'active');

-- A generated dungeon keeps what the generator made (lib/dungeon_gen.js): the
-- floors, rooms, creature groups and treasure. Stored, not rebuilt from the
-- seed each time, so a later change to the creature list cannot change a
-- dungeon that towns are already walking through.
ALTER TABLE dungeons ADD COLUMN IF NOT EXISTS layout JSONB;

-- A fight inside a run is an ordinary battle row that names its run.
ALTER TABLE settlement_quests ADD COLUMN IF NOT EXISTS dungeon_run_id INTEGER;

-- The title of that battle (not on any board: quest_source 'dungeon').
INSERT INTO quest_definitions (id, title, description, icon, category, quest_type, skill_key, base_success, duration_s, reward_gold, quest_source, archived)
VALUES ('dungeon_room', 'In the Dungeon', 'A fight in a dungeon room.', '💀', 'combat', 'party', 'combat', 1.0, 600, 0, 'dungeon', FALSE)
ON CONFLICT (id) DO NOTHING;
