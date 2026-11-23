-- The music jukebox's feedback (jukebox.html on the site; routes/jukebox.js).
-- Idempotent: re-run on every boot.
--
-- jukebox_feedback  one row for each listener and track: their stars (1 to 5),
--                   and a comment and a name if they left them. A listener is
--                   a random id their browser keeps: nobody signs in. Rating
--                   the same track again changes the row. `ip_hash` is a
--                   salted hash of the address it came from, kept only to
--                   stop one address filling the table; the address itself is
--                   never stored.

CREATE TABLE IF NOT EXISTS jukebox_feedback (
  id          BIGSERIAL PRIMARY KEY,
  track       TEXT        NOT NULL,
  visitor     TEXT        NOT NULL,
  stars       SMALLINT    NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT        NOT NULL DEFAULT '',
  name        TEXT        NOT NULL DEFAULT '',
  ip_hash     TEXT        NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (track, visitor)
);
CREATE INDEX IF NOT EXISTS jukebox_feedback_ip ON jukebox_feedback (ip_hash, created_at);
