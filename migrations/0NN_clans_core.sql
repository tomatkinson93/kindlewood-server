-- 0NN_clans_core.sql — clans, membership, ranks/permissions, invites, activity
-- Spec 016 Phase 1. Idempotent: db.js initDB() re-applies it on every boot
-- (matched by the `_clans_core.sql` suffix), and it can also be run by hand.
-- Rename 0NN to the next free migration number at deploy time.
BEGIN;

CREATE TABLE IF NOT EXISTS clans (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  -- { emblem, primary, secondary } — swatch/emblem IDS from CLAN_PALETTE (§9.1),
  -- never raw hex. Validated server-side against the registry + unlock rules.
  banner                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  founder_user_id        INTEGER NOT NULL REFERENCES users(id),
  hq_q                   INTEGER,          -- seed tile (founder's settlement at creation)
  hq_r                   INTEGER,
  level                  INTEGER NOT NULL DEFAULT 1,
  prestige               BIGINT  NOT NULL DEFAULT 0,  -- spendable balance
  prestige_lifetime      BIGINT  NOT NULL DEFAULT 0,  -- monotonic; drives level
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clans_name_lower_uniq ON clans (LOWER(name));

-- One clan per user, enforced by the primary key itself.
CREATE TABLE IF NOT EXISTS clan_members (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  clan_id               INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  rank                  TEXT    NOT NULL DEFAULT 'recruit'
                        CHECK (rank IN ('founder','leader','officer','member','recruit')),
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Daily-cap bookkeeping (§5). prestige_day is the UTC date prestige_today
  -- belongs to; a grant on a new day resets it in the same UPDATE.
  prestige_day          DATE,
  prestige_today        INTEGER NOT NULL DEFAULT 0,   -- RAW (pre-cap) points today
  prestige_contributed  BIGINT  NOT NULL DEFAULT 0    -- effective points, roster display
);
CREATE INDEX IF NOT EXISTS clan_members_clan_idx ON clan_members (clan_id);
CREATE UNIQUE INDEX IF NOT EXISTS clan_members_one_founder
  ON clan_members (clan_id) WHERE rank = 'founder';

CREATE TABLE IF NOT EXISTS clan_rank_permissions (
  clan_id    INTEGER REFERENCES clans(id) ON DELETE CASCADE,  -- NULL = default
  rank       TEXT NOT NULL,
  permission TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS clan_rank_perm_uniq
  ON clan_rank_permissions (COALESCE(clan_id, 0), rank, permission);

-- Seed defaults (idempotent). Full matrix in §4.
INSERT INTO clan_rank_permissions (clan_id, rank, permission) VALUES
  (NULL,'founder','invite'),(NULL,'founder','kick'),(NULL,'founder','claim_territory'),
  (NULL,'founder','spend_prestige'),(NULL,'founder','post_forum'),(NULL,'founder','pin_forum'),
  (NULL,'founder','moderate'),(NULL,'founder','edit_profile'),(NULL,'founder','manage_ranks'),
  (NULL,'founder','transfer_leadership'),(NULL,'founder','disband'),
  (NULL,'leader','invite'),(NULL,'leader','kick'),(NULL,'leader','claim_territory'),
  (NULL,'leader','spend_prestige'),(NULL,'leader','post_forum'),(NULL,'leader','pin_forum'),
  (NULL,'leader','moderate'),(NULL,'leader','edit_profile'),(NULL,'leader','manage_ranks'),
  (NULL,'officer','invite'),(NULL,'officer','claim_territory'),(NULL,'officer','post_forum'),
  (NULL,'officer','pin_forum'),(NULL,'officer','moderate'),
  (NULL,'member','post_forum')
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS clan_invites (
  id               SERIAL PRIMARY KEY,
  clan_id          INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  invited_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by       INTEGER NOT NULL REFERENCES users(id),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','accepted','declined','revoked')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clan_invites_pending_uniq
  ON clan_invites (clan_id, invited_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS clan_invites_user_idx ON clan_invites (invited_user_id);

-- Activity feed + audit ledger (prestige grants/spends land here too).
CREATE TABLE IF NOT EXISTS clan_activity (
  id             SERIAL PRIMARY KEY,
  clan_id        INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,          -- member_joined, prestige_earned, territory_claimed, ...
  actor_user_id  INTEGER REFERENCES users(id),
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS clan_activity_clan_idx ON clan_activity (clan_id, id DESC);

COMMIT;
