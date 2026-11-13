-- Phase 1, step 1 (docs/PHASE_1_LIFE_CYCLE.md §9): unblock the live game.
-- Idempotent; every statement only touches rows that still need it.

-- Houses hold 4 (was 2), so a couple has room for children.
ALTER TABLE houses ALTER COLUMN capacity SET DEFAULT 4;
UPDATE houses SET capacity = 4 WHERE building_type = 'starter_house' AND capacity < 4;

-- The dead give up their bed.
UPDATE citizens SET house_id = NULL WHERE life_stage = 'deceased' AND house_id IS NOT NULL;

-- The population number follows the real count of the living (it was stuck
-- at 10). lib/life.js recount keeps it in step from now on.
UPDATE settlements s
   SET population = c.n
  FROM (SELECT s2.id, COUNT(c2.id) AS n
          FROM settlements s2
          LEFT JOIN citizens c2 ON c2.settlement_id = s2.id AND COALESCE(c2.life_stage, 'adult') <> 'deceased'
         GROUP BY s2.id) c
 WHERE c.id = s.id AND s.population IS DISTINCT FROM c.n;
