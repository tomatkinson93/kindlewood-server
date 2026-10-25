-- 0NN_resources.sql — the resources beyond food/timber/stone/iron/wealth.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_resources.sql`), so
-- every statement is idempotent.
--
-- One INTEGER column per resource in lib/resource_defs.js (scripts/
-- resources_test.js checks the list matches), so every existing
-- `UPDATE settlements SET <res> = <res> + …` pattern keeps working.
--
-- settlement_discoveries: the non-starting resources a town knows about.
--   source  mine | outpost | market | village | expedition | research | smelter | admin | stock
BEGIN;
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS copper     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tin        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS coal       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS silver     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goldore    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gems       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obsidian   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mithril    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS moonsilver INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bronze     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS steel      INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS settlement_discoveries (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  key            TEXT NOT NULL,
  source         TEXT NOT NULL DEFAULT 'stock',
  discovered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  seen           BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (settlement_id, key)
);
COMMIT;
