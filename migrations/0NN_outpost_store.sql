-- Outpost stores and porter hauls (lib/outpost_store). Idempotent.
-- The outposts table comes later on a fresh database (POST /api/game/migrate
-- adds store and store_tick itself), so its parts are guarded.

DO $$ BEGIN
  IF to_regclass('public.outposts') IS NOT NULL THEN
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS store JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS store_tick TIMESTAMPTZ DEFAULT date_trunc('milliseconds', NOW());
    -- Outposts from before stores start empty, from now.
    UPDATE outposts SET store_tick = date_trunc('milliseconds', NOW()) WHERE store_tick IS NULL;
  END IF;
END $$;

-- A standing hauler is a third kind of outpost post.
DO $$ BEGIN
  IF to_regclass('public.outpost_crew') IS NOT NULL THEN
    ALTER TABLE outpost_crew DROP CONSTRAINT IF EXISTS outpost_crew_post_check;
    ALTER TABLE outpost_crew ADD CONSTRAINT outpost_crew_post_check CHECK (post IN ('worker', 'garrison', 'hauler'));
  END IF;
END $$;

-- Porter runs between the town and an outpost: out (arrives_at), load up,
-- home (returns_at). `standing` runs belong to the outpost's hauler.
CREATE TABLE IF NOT EXISTS outpost_hauls (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL,
  outpost_id     INTEGER NOT NULL,
  citizen_id     INTEGER NOT NULL REFERENCES citizens(id) ON DELETE CASCADE,
  standing       BOOLEAN NOT NULL DEFAULT FALSE,
  status         TEXT NOT NULL DEFAULT 'outbound' CHECK (status IN ('outbound', 'returning', 'done')),
  carry          NUMERIC(10,2) NOT NULL DEFAULT 20,
  load           JSONB,
  departs_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  arrives_at     TIMESTAMPTZ NOT NULL,
  returns_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outpost_hauls_active ON outpost_hauls (settlement_id) WHERE status IN ('outbound', 'returning');
CREATE UNIQUE INDEX IF NOT EXISTS uq_outpost_hauls_citizen_active ON outpost_hauls (citizen_id) WHERE status IN ('outbound', 'returning');
