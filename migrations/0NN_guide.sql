-- The guide (docs/PHASE_3_ONBOARDING.md; lib/guide.js): one row per player
-- who has been offered the tour. A row is made when a town is founded, so
-- towns from before this have none (and see no tour unless they ask for a
-- replay in Help).
BEGIN;

CREATE TABLE IF NOT EXISTS guide_progress (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  step       TEXT NOT NULL,                      -- the beat they are on
  state      TEXT NOT NULL DEFAULT 'active',     -- active | done | skipped
  data       JSONB NOT NULL DEFAULT '{}'::jsonb, -- gifts given, notes, the errand, who the lines name
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
