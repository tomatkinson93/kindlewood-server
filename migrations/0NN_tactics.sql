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
CREATE UNIQUE INDEX IF NOT EXISTS tactics_battles_one_active ON tactics_battles (settlement_id) WHERE status = 'active';
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

