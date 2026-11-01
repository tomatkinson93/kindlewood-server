-- 0NN_cards.sql — battle cards and deck templates.
-- Rename 0NN to the next free migration number at deploy time; db.js
-- initDB() re-applies it on every boot (matched by `_cards.sql`), so every
-- statement is idempotent. These tables were made by hand on the live
-- database; this file creates them on new ones (IF NOT EXISTS leaves the
-- live tables as they are).
--
-- card_templates             admin-authored cards (routes/card_admin.js);
--                            code cards live in lib/card_definitions.js
-- settlement_unlocked_cards  cards a settlement owns (unlocking comes later)
-- settlement_deck_templates  a settlement's saved decks; at most one active
--                            (routes/decks.js; combat_resolver reads it)
BEGIN;
CREATE TABLE IF NOT EXISTS card_templates (
  card_key        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  cost            INTEGER NOT NULL DEFAULT 0,
  card_type       TEXT NOT NULL DEFAULT 'attack',
  target          TEXT NOT NULL DEFAULT 'enemy',
  rarity          TEXT NOT NULL DEFAULT 'common',
  rarity_order    INTEGER NOT NULL DEFAULT 0,
  description     TEXT NOT NULL DEFAULT '',
  formula         TEXT NOT NULL DEFAULT '',
  art_url         TEXT,
  sfx             TEXT,
  hit             TEXT NOT NULL DEFAULT 'choose',
  pierce_count    INTEGER,
  pierce_falloff  NUMERIC NOT NULL DEFAULT 1.0,
  wither          BOOLEAN NOT NULL DEFAULT FALSE,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settlement_unlocked_cards (
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  card_key       TEXT NOT NULL,
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (settlement_id, card_key)
);

CREATE TABLE IF NOT EXISTS settlement_deck_templates (
  id             SERIAL PRIMARY KEY,
  settlement_id  INTEGER NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  name           TEXT NOT NULL DEFAULT 'Deck',
  cards          JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS settlement_deck_templates_sett_idx ON settlement_deck_templates (settlement_id);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_deck_templates_one_active
  ON settlement_deck_templates (settlement_id) WHERE is_active;
COMMIT;
