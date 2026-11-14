-- Phase 4 step 6: the outpost trim (docs/OUTPOST_TRIM.md). Goods trickle home
-- by carter, so standing haulers, haul settings and three buildings go.
-- Idempotent: the one-off part runs once (migration_marks). The haul_filter
-- and haul_threshold columns stay, unused (dropping them isn't worth the risk).

-- What carters bring home, a day at a time (the clan "carry goods home" goal
-- counts it with porter loads).
CREATE TABLE IF NOT EXISTS outpost_carted (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  day            DATE NOT NULL,
  goods          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (settlement_id, day)
);

DO $x$ BEGIN
IF NOT EXISTS (SELECT 1 FROM migration_marks WHERE key = 'outpost_trim') THEN
  -- Haulers come home (they lived in town between runs anyway).
  IF to_regclass('public.outpost_crew') IS NOT NULL THEN
    DELETE FROM outpost_crew WHERE post = 'hauler';
  END IF;
  -- Runs already on the road finish as one-off trips.
  IF to_regclass('public.outpost_hauls') IS NOT NULL THEN
    UPDATE outpost_hauls SET standing = FALSE WHERE standing AND status IN ('outbound', 'returning');
  END IF;
  -- The Storehouse, Waystation and Mule Pen: their cost back in full, then gone.
  -- (Costs as they were in lib/outpost_buildings.js.)
  -- (A fresh database may have outpost_buildings before outposts: both must exist.)
  IF to_regclass('public.outpost_buildings') IS NOT NULL AND to_regclass('public.outposts') IS NOT NULL THEN
    UPDATE settlements s SET timber = s.timber + r.timber, stone = s.stone + r.stone, food = s.food + r.food, wealth = s.wealth + r.wealth
      FROM (SELECT o.settlement_id,
                   SUM(CASE b.key WHEN 'storehouse' THEN 120 WHEN 'waystation' THEN 100 WHEN 'mule_pen' THEN 80 ELSE 0 END) AS timber,
                   SUM(CASE b.key WHEN 'storehouse' THEN 60 WHEN 'waystation' THEN 80 ELSE 0 END) AS stone,
                   SUM(CASE b.key WHEN 'mule_pen' THEN 150 ELSE 0 END) AS food,
                   SUM(CASE b.key WHEN 'mule_pen' THEN 40 ELSE 0 END) AS wealth
              FROM outpost_buildings b JOIN outposts o ON o.id = b.outpost_id
             WHERE b.key IN ('storehouse', 'waystation', 'mule_pen')
             GROUP BY o.settlement_id) r
     WHERE s.id = r.settlement_id;
    INSERT INTO settlement_events (settlement_id, type, message)
    SELECT DISTINCT o.settlement_id, 'outpost_refund',
           '📦 Storehouses, Waystations and Mule Pens are no more: carters bring outpost goods home by themselves now. What you spent on yours is back in your stores.'
      FROM outpost_buildings b JOIN outposts o ON o.id = b.outpost_id
     WHERE b.key IN ('storehouse', 'waystation', 'mule_pen');
    DELETE FROM outpost_buildings WHERE key IN ('storehouse', 'waystation', 'mule_pen');
  END IF;
  INSERT INTO migration_marks (key) VALUES ('outpost_trim');
END IF;
END $x$;
