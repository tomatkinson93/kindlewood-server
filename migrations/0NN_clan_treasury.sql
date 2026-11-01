-- R4 group 4: clan treasury, boons, territory income, weekly goals, honors.
-- Idempotent.

ALTER TABLE clans ADD COLUMN IF NOT EXISTS treasury BIGINT NOT NULL DEFAULT 0 CHECK (treasury >= 0);
ALTER TABLE clans ADD COLUMN IF NOT EXISTS territory_paid_on DATE;   -- last day land paid the treasury
ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS donated_day DATE;
ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS donated_today INTEGER NOT NULL DEFAULT 0;

-- Every coin in or out: donations, boons bought, land income, goal rewards.
CREATE TABLE IF NOT EXISTS clan_treasury_log (
  id          SERIAL PRIMARY KEY,
  clan_id     INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('donate', 'boon', 'territory', 'goal', 'admin')),
  amount      INTEGER NOT NULL,          -- + in, − out
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_treasury_log_clan ON clan_treasury_log (clan_id, created_at DESC);

-- Boons bought from the treasury, active until `until` (lib/clan_treasury).
CREATE TABLE IF NOT EXISTS clan_boons (
  clan_id     INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  boon_key    TEXT NOT NULL,
  bought_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  until       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (clan_id, boon_key)
);

-- This week's three goals (ISO week), which are done, and when all were.
CREATE TABLE IF NOT EXISTS clan_weekly_goals (
  clan_id      INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  week         TEXT NOT NULL,             -- e.g. 2026-W44
  goals        JSONB NOT NULL,            -- [{ key, label, icon, target }]
  completed    JSONB NOT NULL DEFAULT '[]',
  all_done_at  TIMESTAMPTZ,
  PRIMARY KEY (clan_id, week)
);

-- Honors a clan has earned (lib/clan_goals HONORS).
CREATE TABLE IF NOT EXISTS clan_honors (
  clan_id     INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  honor_key   TEXT NOT NULL,
  earned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (clan_id, honor_key)
);

-- Spending the treasury: founders, leaders and officers by default.
-- Releasing land: founders and leaders.
INSERT INTO clan_rank_permissions (clan_id, rank, permission) VALUES
  (NULL, 'founder', 'treasury'), (NULL, 'leader', 'treasury'), (NULL, 'officer', 'treasury'),
  (NULL, 'founder', 'release_territory'), (NULL, 'leader', 'release_territory')
ON CONFLICT DO NOTHING;
