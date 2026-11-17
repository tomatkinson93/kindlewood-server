-- Talk to… and Praise (docs/HOME_SCENE.md Part F, F.1 and F.2; lib/social.js).
BEGIN;

-- What each citizen likes to talk about (three topics) and finds dull (one).
-- Kept apart from citizens so it is never sent with them: the player learns
-- a villager's interests through chats. `known`: the topics a chat has
-- touched for this citizen, which is all the player is shown.
CREATE TABLE IF NOT EXISTS citizen_interests (
  citizen_id INTEGER PRIMARY KEY REFERENCES citizens(id) ON DELETE CASCADE,
  likes      JSONB NOT NULL,
  dull       TEXT NOT NULL,
  known      JSONB NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE citizen_interests ADD COLUMN IF NOT EXISTS known JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The chats the player set up. One per speaker per game day; old days are
-- cleared as new chats come in (lib/social.js KEEP_DAYS).
CREATE TABLE IF NOT EXISTS citizen_chats (
  id            SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  speaker_id    INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  listener_id   INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  picked        BOOLEAN NOT NULL DEFAULT TRUE,   -- false: "Anything" (the server chose)
  got_along     BOOLEAN NOT NULL,
  delta         INTEGER NOT NULL,
  day           INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (speaker_id, day)
);
CREATE INDEX IF NOT EXISTS idx_citizen_chats_town ON citizen_chats (settlement_id, day);
CREATE INDEX IF NOT EXISTS idx_citizen_chats_listener ON citizen_chats (listener_id);

-- Praise: three a day per town, a villager at most once a day.
CREATE TABLE IF NOT EXISTS citizen_praise (
  id            SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  citizen_id    INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  day           INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (citizen_id, day)
);
CREATE INDEX IF NOT EXISTS idx_citizen_praise_town ON citizen_praise (settlement_id, day);

COMMIT;
