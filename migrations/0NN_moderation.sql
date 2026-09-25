-- 0NN_moderation.sql — moderator role, content reports, mutes, audit log
-- Additive; db.js initDB() re-applies it on every boot (matched by the
-- `_moderation.sql` suffix). Admins remain the ADMIN_USER_IDS allowlist;
-- moderators are a role on the account that admins grant in-game.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS site_role TEXT NOT NULL DEFAULT 'player';
DO $$ BEGIN
  ALTER TABLE users ADD CONSTRAINT users_site_role_chk CHECK (site_role IN ('player', 'moderator'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A report keeps a snapshot of the content, so moderators see what was
-- reported even if it is later edited or deleted.
CREATE TABLE IF NOT EXISTS chat_reports (
  id                SERIAL PRIMARY KEY,
  reporter_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type       TEXT NOT NULL CHECK (target_type IN ('message', 'post')),
  target_id         INTEGER NOT NULL,
  channel_id        INTEGER REFERENCES chat_channels(id) ON DELETE SET NULL,
  thread_id         INTEGER,
  reported_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  snapshot_body     TEXT NOT NULL,
  reason            TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'inappropriate', 'other')),
  note              TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolution        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_open_uniq
  ON chat_reports (reporter_user_id, target_type, target_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS chat_reports_status_idx ON chat_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_reports_target_idx ON chat_reports (target_type, target_id);

-- Realm-channel mutes (clan halls are the clan's own business). until NULL
-- = until lifted.
CREATE TABLE IF NOT EXISTS user_mutes (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason      TEXT NOT NULL DEFAULT '',
  until       TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log of every moderator action.
CREATE TABLE IF NOT EXISTS mod_actions (
  id              SERIAL PRIMARY KEY,
  actor_user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  target_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS mod_actions_created_idx ON mod_actions (created_at DESC);
COMMIT;
