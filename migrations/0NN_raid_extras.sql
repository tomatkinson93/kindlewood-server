-- Raid extras: call to arms (clanmates reinforce), sallies, Withered camps.
-- Idempotent.

-- Guards and Archers a clanmate sent to hold a raided spot, until it resolves.
CREATE TABLE IF NOT EXISTS raid_reinforcements (
  citizen_id     INTEGER PRIMARY KEY REFERENCES citizens(id) ON DELETE CASCADE,
  raid_id        INTEGER NOT NULL REFERENCES settlement_raids(id) ON DELETE CASCADE,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,   -- whose citizen
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reinforcements_raid ON raid_reinforcements (raid_id);

-- A sally: one card battle per raid (settlement_quests run 'raid_sally').
ALTER TABLE settlement_raids ADD COLUMN IF NOT EXISTS sally_run_id INTEGER;
ALTER TABLE settlement_raids ADD COLUMN IF NOT EXISTS sally_outcome TEXT;
-- Raids come from the nearest camp when there is one.
ALTER TABLE settlement_raids ADD COLUMN IF NOT EXISTS from_camp_id INTEGER;

-- Withered camps near their villages; clearing one brings the area peace.
CREATE TABLE IF NOT EXISTS withered_camps (
  id           SERIAL PRIMARY KEY,
  npc_id       INTEGER REFERENCES npc_settlements(id) ON DELETE CASCADE,
  q            INTEGER NOT NULL,
  r            INTEGER NOT NULL,
  strength     INTEGER NOT NULL,
  spawned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at   TIMESTAMPTZ,
  cleared_by   INTEGER REFERENCES settlements(id) ON DELETE SET NULL,
  run_id       INTEGER   -- the party quest attacking it
);
CREATE INDEX IF NOT EXISTS idx_camps_open ON withered_camps (q, r) WHERE cleared_at IS NULL;
