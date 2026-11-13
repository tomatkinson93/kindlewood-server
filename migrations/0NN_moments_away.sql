-- Phase 2 step 5: a citizen sent away for a while by a moment (M18: helping a
-- village). lib/careers awayMap counts them away until then. Idempotent.
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS away_until TIMESTAMPTZ;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS away_reason TEXT;
