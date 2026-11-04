-- Outpost buildings, and crew who walk to and from their posts. Idempotent.

-- Small buildings inside an outpost (lib/outpost_buildings). One of each.
CREATE TABLE IF NOT EXISTS outpost_buildings (
  outpost_id  INTEGER NOT NULL,
  key         TEXT NOT NULL,
  built_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ready_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (outpost_id, key)
);

-- Walks on the same road as porters: 'post' (out to a new post, one way) and
-- 'return' (home from a post, one way) beside 'haul' (out, load up, back).
ALTER TABLE outpost_hauls ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'haul';
ALTER TABLE outpost_hauls DROP CONSTRAINT IF EXISTS outpost_hauls_kind_check;
ALTER TABLE outpost_hauls ADD CONSTRAINT outpost_hauls_kind_check CHECK (kind IN ('haul', 'post', 'return'));

-- Crew still walking out: they count once arrives_at has passed (NULL = there).
DO $$ BEGIN
  IF to_regclass('public.outpost_crew') IS NOT NULL THEN
    ALTER TABLE outpost_crew ADD COLUMN IF NOT EXISTS arrives_at TIMESTAMPTZ;
  END IF;
END $$;
