-- Phase 2 step 4: timed town effects (docs/PHASE_2_MOMENTS.md §6a). A moment's
-- outcome that lasts a while: "+10% production for the season", "births more
-- likely next spring". Read by lib/town_mods (production, happiness, food
-- upkeep) and simulation.js (birth chance). Idempotent.
CREATE TABLE IF NOT EXISTS town_effects (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,                         -- e.g. 'moment:late_work'
  label          TEXT NOT NULL,                         -- shown in the breakdown
  mods           JSONB NOT NULL DEFAULT '{}'::jsonb,    -- { all_production, food_production, wealth_production, happiness, food_upkeep, birth_chance }
  starts_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at        TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_town_effects_town ON town_effects (settlement_id, ends_at);
