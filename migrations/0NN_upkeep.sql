-- Upkeep and building health (docs/HOME_SCENE.md Part E; lib/upkeep.js).
BEGIN;

-- Health, 0 to 100, for every building and every home. 0 is broken.
ALTER TABLE buildings ADD COLUMN IF NOT EXISTS health NUMERIC(6,2) NOT NULL DEFAULT 100;
ALTER TABLE houses    ADD COLUMN IF NOT EXISTS health NUMERIC(6,2) NOT NULL DEFAULT 100;

-- upkeep_on: upkeep is on for this town (the switch `upkeep.on` turns it on
-- for every town). upkeep_at: when wear and repair were last worked out.
-- upkeep_warned: the "nobody is looking after the town" line has been
-- written for the present spell without a builder.
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS upkeep_on BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS upkeep_at TIMESTAMPTZ;
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS upkeep_warned BOOLEAN NOT NULL DEFAULT FALSE;

-- A repair the player put in the builders' queue ("Repair now"): the house it
-- is for (a building is named by its type).
ALTER TABLE construction_sites ADD COLUMN IF NOT EXISTS target_id INTEGER;

COMMIT;
