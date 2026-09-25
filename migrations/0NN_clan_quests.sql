-- 0NN_clan_quests.sql — clan quests: solo and party runs (spec 016 follow-up)
-- Additive; db.js initDB() re-applies it on every boot (matched by the
-- `_clan_quests.sql` suffix). Definitions live in lib/clan_quests.js.
BEGIN;
-- One run of a clan quest. Solo runs start 'active'; party runs start
-- 'forming' and go 'active' when the last role is filled.
CREATE TABLE IF NOT EXISTS clan_quest_runs (
  id              SERIAL PRIMARY KEY,
  clan_id         INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  quest_key       TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('solo', 'party')),
  status          TEXT NOT NULL CHECK (status IN ('forming', 'active', 'completed', 'failed', 'expired', 'cancelled')),
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  day             DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')::date,  -- daily limits
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,          -- forming parties lapse after this
  started_at      TIMESTAMPTZ,
  completes_at    TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  success_chance  REAL,
  success_roll    REAL
);
CREATE INDEX IF NOT EXISTS clan_quest_runs_clan_idx ON clan_quest_runs (clan_id, status);
CREATE INDEX IF NOT EXISTS clan_quest_runs_due_idx ON clan_quest_runs (status, completes_at);
-- One forming/active party per quest per clan.
CREATE UNIQUE INDEX IF NOT EXISTS clan_quest_runs_party_uniq
  ON clan_quest_runs (clan_id, quest_key) WHERE kind = 'party' AND status IN ('forming', 'active');

-- A member's citizen in a run. One role per member per run, one member per
-- role, and a citizen can only be in one live clan run (active = true while
-- the run is forming or active).
CREATE TABLE IF NOT EXISTS clan_quest_slots (
  run_id         INTEGER NOT NULL REFERENCES clan_quest_runs(id) ON DELETE CASCADE,
  role_index     INTEGER NOT NULL,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  citizen_id     INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rewards        JSONB,                 -- what this participant received
  prestige       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, role_index)
);
CREATE UNIQUE INDEX IF NOT EXISTS clan_quest_slots_member_uniq ON clan_quest_slots (run_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS clan_quest_slots_citizen_live ON clan_quest_slots (citizen_id) WHERE active;
CREATE INDEX IF NOT EXISTS clan_quest_slots_user_idx ON clan_quest_slots (user_id, active);
-- Clan quest definitions live in quest_definitions (quest_source = 'clan'),
-- edited in the Dev Tools quest admin.
ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS clan_min_level INTEGER NOT NULL DEFAULT 1;
ALTER TABLE quest_definitions ADD COLUMN IF NOT EXISTS clan_prestige  INTEGER NOT NULL DEFAULT 0;

-- Encounters (auto-resolved; see lib/clan_quests.js).
ALTER TABLE clan_quest_runs ADD COLUMN IF NOT EXISTS combat_status     TEXT NOT NULL DEFAULT 'none';  -- none | rolled | resolved
ALTER TABLE clan_quest_runs ADD COLUMN IF NOT EXISTS combat_trigger_at TIMESTAMPTZ;
ALTER TABLE clan_quest_runs ADD COLUMN IF NOT EXISTS combat_seed       BIGINT;
ALTER TABLE clan_quest_runs ADD COLUMN IF NOT EXISTS combat_encounter  JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE clan_quest_runs ADD COLUMN IF NOT EXISTS combat_outcome    TEXT;                          -- victory | defeat
ALTER TABLE clan_quest_runs ADD COLUMN IF NOT EXISTS combat_log        JSONB;
CREATE INDEX IF NOT EXISTS clan_quest_runs_combat_idx ON clan_quest_runs (status, combat_status, combat_trigger_at);
COMMIT;
