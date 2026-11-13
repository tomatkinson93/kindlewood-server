-- Phase 2: moments (docs/PHASE_2_MOMENTS.md §2.1). Replaces outpost_events;
-- open outpost events are copied across once. Idempotent.
CREATE TABLE IF NOT EXISTS moments (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  subject        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { citizen_ids, family_id, outpost_id, npc_id }
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,   -- fixed when it starts: names, amounts, odds
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  resolved_at    TIMESTAMPTZ,
  choice         TEXT,
  outcome        TEXT,
  auto           BOOLEAN NOT NULL DEFAULT FALSE         -- the default was taken
);
CREATE INDEX IF NOT EXISTS idx_moments_open ON moments (settlement_id) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_moments_town ON moments (settlement_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_moments_due ON moments (expires_at) WHERE resolved_at IS NULL;

CREATE TABLE IF NOT EXISTS migration_marks (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW());
DO $x$ BEGIN
IF NOT EXISTS (SELECT 1 FROM migration_marks WHERE key = 'moments_from_outpost_events') THEN
  IF to_regclass('public.outpost_events') IS NOT NULL THEN
    INSERT INTO moments (settlement_id, kind, subject, data, created_at, expires_at)
    SELECT e.settlement_id, e.kind, jsonb_build_object('outpost_id', e.outpost_id), e.data, e.created_at, e.expires_at
      FROM outpost_events e WHERE e.resolved_at IS NULL;
    UPDATE outpost_events SET resolved_at = NOW(), outcome = 'Moved to moments' WHERE resolved_at IS NULL;
  END IF;
  INSERT INTO migration_marks (key) VALUES ('moments_from_outpost_events');
END IF;
END $x$;

-- When the engine first looked at a town: its first moment follows a few minutes later.
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS moments_seen_at TIMESTAMPTZ;
