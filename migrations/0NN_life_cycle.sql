-- Phase 1, steps 2–6: the life cycle (docs/PHASE_1_LIFE_CYCLE.md §3).
-- Idempotent. The one-off part (existing adults start ageing) is guarded by
-- migration_marks so it runs exactly once.

ALTER TABLE citizens ADD COLUMN IF NOT EXISTS family_id INTEGER;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS died_at TIMESTAMPTZ;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS death_cause TEXT;
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS apprentice_class TEXT;     -- a youth's chosen trade
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS mentor_id INTEGER;         -- and their teacher
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS last_birthday_year INTEGER; -- last age whose death roll was made
ALTER TABLE citizens ADD COLUMN IF NOT EXISTS last_child_at TIMESTAMPTZ;  -- the gap between births

-- Family lines. One per surname in a town (a settler's new surname starts a new one).
CREATE TABLE IF NOT EXISTS families (
  id               SERIAL PRIMARY KEY,
  settlement_id    INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  founded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  head_citizen_id  INTEGER,
  UNIQUE (settlement_id, name)
);
CREATE INDEX IF NOT EXISTS idx_citizens_family ON citizens (family_id);

-- The family record: births, comings of age, partnerships, deaths, inheritances, …
CREATE TABLE IF NOT EXISTS chronicle (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  family_id      INTEGER,
  citizen_ids    JSONB NOT NULL DEFAULT '[]'::jsonb,
  kind           TEXT NOT NULL,
  text           TEXT NOT NULL,
  at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chronicle_town ON chronicle (settlement_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_chronicle_family ON chronicle (family_id, at DESC);

-- Existing towns, once: age starts moving from each living adult's shown age,
-- capped at 45 so nobody is suddenly elderly. Children keep their real born_at.
CREATE TABLE IF NOT EXISTS migration_marks (key TEXT PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT NOW());
DO $x$ BEGIN
IF NOT EXISTS (SELECT 1 FROM migration_marks WHERE key = 'life_cycle_ages') THEN
  UPDATE citizens
     SET born_at = NOW() - make_interval(hours => (28 * LEAST(45, GREATEST(12,
           CASE WHEN (life->>'age') ~ '^[0-9]+(\.[0-9]+)?$' THEN (life->>'age')::numeric ELSE 25 END)))::int)
   WHERE COALESCE(life_stage, 'adult') = 'adult';
  -- No death rolls for years lived before the life cycle existed.
  UPDATE citizens SET last_birthday_year = FLOOR(EXTRACT(EPOCH FROM (NOW() - born_at)) / (28 * 3600))::int
   WHERE COALESCE(life_stage, 'adult') <> 'deceased' AND last_birthday_year IS NULL;
  INSERT INTO migration_marks (key) VALUES ('life_cycle_ages');
END IF;
END $x$;

-- Anyone without a family joins (or founds) the one named for their surname.
INSERT INTO families (settlement_id, name)
SELECT DISTINCT c.settlement_id, COALESCE(NULLIF(split_part(c.name, ' ', 2), ''), 'Woodkin')
  FROM citizens c
 WHERE c.family_id IS NULL AND c.settlement_id IS NOT NULL
ON CONFLICT (settlement_id, name) DO NOTHING;
UPDATE citizens c
   SET family_id = f.id
  FROM families f
 WHERE c.family_id IS NULL AND f.settlement_id = c.settlement_id
   AND f.name = COALESCE(NULLIF(split_part(c.name, ' ', 2), ''), 'Woodkin');

-- Inheritances (step 4, §4.8): opened at a death with the default heir;
-- the player may pick another from the family until settle_at, then the
-- default happens by itself. Heirlooms are the item_ids, already tagged.
CREATE TABLE IF NOT EXISTS inheritances (
  id               SERIAL PRIMARY KEY,
  settlement_id    INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  deceased_id      INTEGER NOT NULL,
  family_id        INTEGER,
  default_heir_id  INTEGER,
  heir_id          INTEGER,
  class_key        TEXT,
  xp               NUMERIC NOT NULL DEFAULT 0,
  item_ids         JSONB NOT NULL DEFAULT '[]'::jsonb,
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'settled')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settle_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + interval '24 hours',
  settled_at       TIMESTAMPTZ,
  UNIQUE (deceased_id)
);
CREATE INDEX IF NOT EXISTS idx_inheritances_open ON inheritances (settlement_id) WHERE status = 'open';

-- The head of each family is its oldest living adult.
UPDATE families f SET head_citizen_id = (
  SELECT c.id FROM citizens c WHERE c.family_id = f.id AND c.life_stage = 'adult' ORDER BY c.born_at ASC, c.id ASC LIMIT 1)
 WHERE f.head_citizen_id IS DISTINCT FROM (
  SELECT c.id FROM citizens c WHERE c.family_id = f.id AND c.life_stage = 'adult' ORDER BY c.born_at ASC, c.id ASC LIMIT 1);

-- Settlers (step 5, §4.7): when the last one arrived. NULL until the town's
-- first check, which only starts the clock.
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS last_settler_at TIMESTAMPTZ;

-- The life numbers changed in Dev Tools (step 7, lib/tuning.js LIFE_KEYS).
-- No row = the default. career_tuning only takes multipliers of 0–5.
CREATE TABLE IF NOT EXISTS life_tuning (
  key         TEXT PRIMARY KEY,
  value       NUMERIC NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
