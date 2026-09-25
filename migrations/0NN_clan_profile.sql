-- 0NN_clan_profile.sql — public clan profile + roster polish (spec 016 Phase 5)
-- Additive; db.js initDB() re-applies it on every boot (matched by the
-- `_clan_profile.sql` suffix).
BEGIN;
-- Cosmetic member title (clan level 5+), shown on the roster, the public
-- clan profile and the member's player profile.
ALTER TABLE clan_members ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
-- "Recruiting" flag on the public profile.
ALTER TABLE clans ADD COLUMN IF NOT EXISTS recruiting BOOLEAN NOT NULL DEFAULT FALSE;
-- Last time the player's live stream was open (roster "seen 3h ago").
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
COMMIT;
