-- 0NN_chat_hub.sql — Chat hub: channels, forum threads/posts, live chat (spec 016 Phase 4)
-- Idempotent: db.js initDB() re-applies it on every boot (matched by the
-- `_chat_hub.sql` suffix). Rename 0NN at deploy time.
-- Chat hub: channel-keyed so global channels are a row, not a migration.
BEGIN;
CREATE TABLE IF NOT EXISTS chat_channels (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('clan','global')),
  clan_id     INTEGER REFERENCES clans(id) ON DELETE CASCADE,  -- set iff kind='clan'
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((kind = 'clan') = (clan_id IS NOT NULL))
);
-- Exactly one channel per clan in v1.
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_clan_uniq
  ON chat_channels (clan_id) WHERE kind = 'clan';

CREATE TABLE IF NOT EXISTS forum_threads (
  id              SERIAL PRIMARY KEY,
  channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  reply_count     INTEGER NOT NULL DEFAULT 0,
  last_post_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS forum_threads_list_idx
  ON forum_threads (channel_id, pinned DESC, last_post_at DESC);

-- The opening post is row #1 of its thread; replies follow.
CREATE TABLE IF NOT EXISTS forum_posts (
  id              SERIAL PRIMARY KEY,
  thread_id       INTEGER NOT NULL REFERENCES forum_threads(id) ON DELETE CASCADE,
  author_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS forum_posts_thread_idx ON forum_posts (thread_id, id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              SERIAL PRIMARY KEY,
  channel_id      INTEGER NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  author_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system line
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS chat_messages_channel_idx ON chat_messages (channel_id, id DESC);

-- Backfill: clans founded before this migration get their channel.
INSERT INTO chat_channels (kind, clan_id, name)
  SELECT 'clan', c.id, c.name FROM clans c
  WHERE NOT EXISTS (SELECT 1 FROM chat_channels ch WHERE ch.clan_id = c.id);
COMMIT;
