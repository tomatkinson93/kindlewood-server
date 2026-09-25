-- 0NN_clan_profile.sql — public clan profile, roster polish and recruitment
-- (spec 016 Phase 5). Additive; db.js initDB() re-applies it on every boot
-- (matched by the `_clan_profile.sql` suffix).
BEGIN;
-- Cosmetic member title (clan level 5+), shown on the roster, the public
-- clan profile and the member's player profile.
ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

-- How players get in: 'invite' (default — invitations only), 'request'
-- (players ask, officers approve) or 'open' (anyone may join).
ALTER TABLE clans ADD COLUMN IF NOT EXISTS join_policy TEXT NOT NULL DEFAULT 'invite';
DO $$ BEGIN
  ALTER TABLE clans ADD CONSTRAINT clans_join_policy_chk CHECK (join_policy IN ('invite', 'request', 'open'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS clan_join_requests (
  id          SERIAL PRIMARY KEY,
  clan_id     INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  decided_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS clan_join_requests_pending_uniq
  ON clan_join_requests (clan_id, user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS clan_join_requests_user_idx ON clan_join_requests (user_id, status);

-- Who may change the join policy (founder + leaders by default). Requests
-- are answered by anyone holding 'invite'.
INSERT INTO clan_rank_permissions (clan_id, rank, permission) VALUES
  (NULL, 'founder', 'manage_recruitment'), (NULL, 'leader', 'manage_recruitment')
ON CONFLICT DO NOTHING;

-- Last time the player's live stream was open (roster "seen 3h ago").
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
COMMIT;
