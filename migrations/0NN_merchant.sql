-- A visiting merchant (docs/HOME_SCENE.md Part F, F.13; lib/merchant.js).
BEGIN;

-- Which of a visit's trades a town has taken. A visit is a game day; its
-- trades are numbered from 0 and each can be taken once. `idx` -1 marks that
-- the visit's arrival has been put in the town's news (once).
CREATE TABLE IF NOT EXISTS merchant_trades (
  id            SERIAL PRIMARY KEY,
  settlement_id INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  day           INTEGER NOT NULL,
  idx           INTEGER NOT NULL,
  taken_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (settlement_id, day, idx)
);

-- Dev Tools: "call the merchant today" sets this to today's game day, and the
-- merchant is here on that day as well as on their own days.
ALTER TABLE settlements ADD COLUMN IF NOT EXISTS merchant_day INTEGER;

COMMIT;
