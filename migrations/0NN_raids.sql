-- R4 group 3: trust that fades, the Allied perk, soft raids by the Withered.
-- Idempotent.

-- Trust decay (lib/trust_decay): after 7 days without contact a village's
-- trust drops 1 a day, never below trust_floor — which only ever rises, to
-- the start of the band below the best band reached (Allied → 41).
ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS trust_floor INTEGER NOT NULL DEFAULT 0;
ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS trust_decayed_at TIMESTAMPTZ;
-- Allied tribute: once per UTC day.
ALTER TABLE diplomacy_relations ADD COLUMN IF NOT EXISTS tribute_day DATE;

-- A raided outpost sits idle until this time (lib/outpost_state). On a fresh
-- database the outposts table comes later (POST /api/game/migrate, which
-- adds the column itself).
DO $$ BEGIN
  IF to_regclass('public.outposts') IS NOT NULL THEN
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS raided_until TIMESTAMPTZ;
  END IF;
END $$;

-- Raids (lib/raids): warned, then they arrive and are repelled or not.
CREATE TABLE IF NOT EXISTS settlement_raids (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  outpost_id     INTEGER,   -- outposts.id (no FK: the table may not exist yet on a fresh database)
  target_name    TEXT NOT NULL,
  from_npc_id    INTEGER REFERENCES npc_settlements(id) ON DELETE SET NULL,
  from_name      TEXT NOT NULL DEFAULT 'the Withered',
  strength       INTEGER NOT NULL,
  defence        INTEGER,
  warned_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrives_at     TIMESTAMPTZ NOT NULL,
  resolved_at    TIMESTAMPTZ,
  outcome        TEXT CHECK (outcome IN ('repelled', 'lost')),
  loot           JSONB
);
CREATE INDEX IF NOT EXISTS idx_raids_open ON settlement_raids (arrives_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_raids_settlement ON settlement_raids (settlement_id, warned_at DESC);
-- At most one raid on its way to a town at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_raids_one_open ON settlement_raids (settlement_id) WHERE resolved_at IS NULL;

-- What a repelled raid sometimes leaves behind.
INSERT INTO item_templates (item_key, name, description, icon, category, rarity, rarity_order, quality, equip_slot, stat_bonuses, sell_value) VALUES
  ('withered_fang', 'Withered Fang', 'Taken from a raider who will not be coming back.', '🦷', 'trophy', 'uncommon', 2, 'basic', NULL, '{}', 25)
ON CONFLICT (item_key) DO NOTHING;
