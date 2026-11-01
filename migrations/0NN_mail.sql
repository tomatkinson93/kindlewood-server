-- 0NN_mail.sql — letters between players (routes/mail.js).
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_mail.sql`), so every
-- statement is idempotent. Runs after 0NN_moderation.sql (chat_reports).
--
-- mail_messages   one letter; each side deletes its own copy (sender_deleted /
--                 recipient_deleted). removed_at: taken down by a moderator.
-- mail_blocks     a player who won't take letters from another.
-- chat_reports    target_type 'mail' joins 'message' and 'post', so reported
--                 letters land in the moderators' existing queue.
BEGIN;
CREATE TABLE IF NOT EXISTS mail_messages (
  id                 SERIAL PRIMARY KEY,
  sender_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  recipient_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject            TEXT NOT NULL DEFAULT '',
  body               TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at            TIMESTAMPTZ,
  sender_deleted     BOOLEAN NOT NULL DEFAULT FALSE,
  recipient_deleted  BOOLEAN NOT NULL DEFAULT FALSE,
  removed_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS mail_inbox_idx ON mail_messages (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mail_sent_idx ON mail_messages (sender_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mail_blocks (
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, blocked_user_id)
);

ALTER TABLE chat_reports DROP CONSTRAINT IF EXISTS chat_reports_target_type_check;
ALTER TABLE chat_reports ADD CONSTRAINT chat_reports_target_type_check CHECK (target_type IN ('message', 'post', 'mail'));
COMMIT;
