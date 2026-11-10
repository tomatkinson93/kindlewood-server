-- Outposts send a share of their output home by themselves (lib/outpost_store,
-- "the carter"). `trickle` holds the fractions still owed. Idempotent.
DO $$ BEGIN
  IF to_regclass('public.outposts') IS NOT NULL THEN
    ALTER TABLE outposts ADD COLUMN IF NOT EXISTS trickle JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;
