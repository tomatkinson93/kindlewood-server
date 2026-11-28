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
  -- travelling | active | cleared | left | fled | defeat | timed_out | recalled
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

-- Dungeons on the world map (lib/dungeon_map.js). Word of a dungeon reaches
-- every town within reach of it: one row per town that has been told, so
-- each is told once (its tile is lit on that town's map at the same time).
CREATE TABLE IF NOT EXISTS dungeon_sightings (
  dungeon_id    INTEGER NOT NULL REFERENCES dungeons(id) ON DELETE CASCADE,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  told_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dungeon_id, settlement_id)
);
CREATE INDEX IF NOT EXISTS idx_dungeons_map_live ON dungeons (expires_at) WHERE source = 'map';

-- The walk (lib/dungeons.js; DUNGEONS.md §15). A party sent to a map dungeon
-- walks there ('travelling' until arrives_at) and walks home when the run
-- ends (home_at). What it carries home, and what the town is to be told, are
-- held in `owed` until it arrives; NULL once settled, or when there was no
-- walk. A party called back on the road is 'recalled' until it is home, and
-- then its row goes, so the town still has its go at that dungeon.
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS arrives_at TIMESTAMPTZ;
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS home_at    TIMESTAMPTZ;
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS walk_secs  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS owed       JSONB;
CREATE INDEX IF NOT EXISTS idx_dungeon_runs_owed ON dungeon_runs (home_at) WHERE owed IS NOT NULL;

-- What the first town to clear a map dungeon wins (lib/dungeon_trophies.js):
-- a trophy from its boss, on a mount for its skull. One a dungeon. Not an
-- item: it hangs in the town's hall. Everything shown is kept on the row, so
-- a trophy outlives its dungeon.
CREATE TABLE IF NOT EXISTS dungeon_trophies (
  id            SERIAL PRIMARY KEY,
  dungeon_id    INTEGER NOT NULL UNIQUE,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  run_id        INTEGER,
  foe_key       TEXT NOT NULL,
  tier          TEXT NOT NULL,
  dungeon_name  TEXT NOT NULL,
  terrain       TEXT,
  party         JSONB NOT NULL DEFAULT '[]',
  wealth        INTEGER NOT NULL DEFAULT 0,
  won_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dungeon_trophies_town ON dungeon_trophies (settlement_id, won_at DESC);

-- Class decks (docs/DUNGEON_CLASS_DECKS.md). Each citizen's deck for the run
-- lives in dungeon_runs.deck: { cards: { citizenId: { card: copies } },
-- spent: { citizenId: [heal cards gone until the party rests] } }. A choice
-- of cards that is waiting (at the door, after a fight) lives in
-- dungeon_runs.draft. Cards the player has set aside, never to be offered:
CREATE TABLE IF NOT EXISTS settlement_card_prefs (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  card_key       TEXT NOT NULL,
  prepared       BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (settlement_id, card_key)
);

-- A fight inside a run is an ordinary battle row that names its run.
ALTER TABLE settlement_quests ADD COLUMN IF NOT EXISTS dungeon_run_id INTEGER;

-- The title of that battle (not on any board: quest_source 'dungeon').
INSERT INTO quest_definitions (id, title, description, icon, category, quest_type, skill_key, base_success, duration_s, reward_gold, quest_source, archived)
VALUES ('dungeon_room', 'In the Dungeon', 'A fight in a dungeon room.', '💀', 'combat', 'party', 'combat', 1.0, 600, 0, 'dungeon', FALSE)
ON CONFLICT (id) DO NOTHING;

-- ── Event rooms, blessings, curses and keepsakes (2026-11-29; lib/dungeon_events.js, DUNGEONS.md §16) ──
-- carried: what a run holds besides loot until it ends: [{ key, kind: 'mark' | 'keepsake', fights? }].
-- event:   an event's fight while it is being fought: { fight: { enemies, kind, boost }, after: outcome | null }.
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS carried JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE dungeon_runs ADD COLUMN IF NOT EXISTS event   JSONB;
