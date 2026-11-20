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
