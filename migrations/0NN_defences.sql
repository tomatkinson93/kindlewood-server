-- R4+ defences: walls, outpost forts and crews, graded raids, tribute.
-- Idempotent. The outposts table comes later on a fresh database (POST
-- /api/game/migrate adds fort_level itself), so its parts are guarded.

DO $$ BEGIN
  IF to_regclass('public.outposts') IS NOT NULL THEN
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS fort_level INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Who is at each outpost: workers (more yield) and garrison (Guards and
-- Archers, defence). One post per citizen.
CREATE TABLE IF NOT EXISTS outpost_crew (
  citizen_id   INTEGER PRIMARY KEY REFERENCES citizens(id) ON DELETE CASCADE,
  outpost_id   INTEGER NOT NULL,
  post         TEXT NOT NULL CHECK (post IN ('worker', 'garrison')),
  assigned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outpost_crew_outpost ON outpost_crew (outpost_id);
-- The single worker from before moves across.
DO $$ BEGIN
  IF to_regclass('public.outposts') IS NOT NULL THEN
    INSERT INTO outpost_crew (citizen_id, outpost_id, post)
      SELECT assigned_citizen_id, id, 'worker' FROM outposts WHERE assigned_citizen_id IS NOT NULL
    ON CONFLICT DO NOTHING;
    UPDATE outposts SET assigned_citizen_id = NULL WHERE assigned_citizen_id IS NOT NULL;
  END IF;
END $$;

-- Tribute to the Withered: peace until, and the escalation streak.
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS raid_peace_until TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS raid_tribute_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS raid_tribute_streak INTEGER NOT NULL DEFAULT 0;

-- Graded outcomes: partial losses, a raid broken by a sally, one turned back by tribute.
ALTER TABLE settlement_raids DROP CONSTRAINT IF EXISTS settlement_raids_outcome_check;
ALTER TABLE settlement_raids ADD CONSTRAINT settlement_raids_outcome_check
  CHECK (outcome IN ('repelled', 'partial', 'lost', 'broken', 'turned_back'));
ALTER TABLE settlement_raids ADD COLUMN IF NOT EXISTS loss_share NUMERIC(5,3);
