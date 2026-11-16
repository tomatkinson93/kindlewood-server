-- The Neighbourhood (docs/HOME_SCENE.md Part C, step 10).
-- A town's houses stand on numbered plots in a neighbourhood. Modelled for
-- several neighbourhoods per town from the start; a town has one for now.
-- Houses are seated on plots by lib/neighbourhoods.js (seat), which runs at
-- boot and whenever a house without a plot is found.
BEGIN;

CREATE TABLE IF NOT EXISTS neighbourhoods (
  id            SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (settlement_id, position)
);

ALTER TABLE houses ADD COLUMN IF NOT EXISTS neighbourhood_id INTEGER REFERENCES neighbourhoods(id) ON DELETE SET NULL;
ALTER TABLE houses ADD COLUMN IF NOT EXISTS plot INTEGER;
ALTER TABLE houses ADD COLUMN IF NOT EXISTS style TEXT;
-- 'built' now; building time (Part D) adds 'site'.
ALTER TABLE houses ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'built';
-- True once the player has named the house; until then it is shown by the
-- family living in it.
ALTER TABLE houses ADD COLUMN IF NOT EXISTS custom_name BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_houses_plot ON houses (neighbourhood_id, plot) WHERE plot IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_neighbourhoods_settlement ON neighbourhoods (settlement_id);

COMMIT;
