-- 0NN_research.sql — the Library: what each town has studied.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_research.sql`), so
-- every statement is idempotent.
--
-- settlement_research   one row per project a town has put points into
--   progress            research points so far (lib/research_defs.js cost)
--   done_at             set when finished; unlocks its resources, buildings,
--                       recipes and effects
-- settlements.research_active     the project points flow into (or NULL)
-- settlements.research_bank       points earned with nothing to study
--                                 (spent on the next project; capped)
-- settlements.research_settled_at the scholars' clock (lib/research.js)
BEGIN;
CREATE TABLE IF NOT EXISTS settlement_research (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  project        TEXT NOT NULL,
  progress       NUMERIC(12,3) NOT NULL DEFAULT 0,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  done_at        TIMESTAMPTZ,
  PRIMARY KEY (settlement_id, project)
);
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS research_active      TEXT,
  ADD COLUMN IF NOT EXISTS research_bank        NUMERIC(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_settled_at  TIMESTAMPTZ;
COMMIT;
