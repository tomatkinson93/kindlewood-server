-- 0NN_cards_retired.sql — the card battler is gone (docs/TACTICS.md §8,
-- 2026-11-26): every battle is fought on the board, and a combat card does
-- nothing any more. Rename 0NN to the next free migration number at deploy
-- time; db.js initDB() re-applies it on every boot (matched by the
-- `_cards_retired.sql` suffix), so every statement is idempotent. Runs after
-- 0NN_cards.sql and 0NN_tactics.sql.
--
-- Nothing a town earned is taken for nothing: each card it had won in
-- battle, found on a quest or bought from an Allied village is bought back,
-- once, at what a village charged for a card of that rarity (the PRICE table
-- of the old lib/cards.js), and the town is told in its news. Cards given by
-- Dev Tools or a test are not paid for. The rows stay, marked, so this is
-- done once however often the server starts.
--
-- The card tables themselves (card_templates, settlement_unlocked_cards, the
-- decks) are left where they are: nothing reads them, and nothing is lost if
-- they are ever wanted again.
ALTER TABLE settlement_unlocked_cards ADD COLUMN IF NOT EXISTS bought_back_at TIMESTAMPTZ;

WITH due AS (
  UPDATE settlement_unlocked_cards u SET bought_back_at = NOW()
   WHERE u.bought_back_at IS NULL
  RETURNING u.settlement_id, u.card_key, COALESCE(u.source, '') AS source
), earned AS (
  SELECT d.settlement_id, d.card_key FROM due d
   WHERE d.source = 'battle' OR d.source = 'quest' OR d.source LIKE 'village%'
), priced AS (
  SELECT e.settlement_id,
         CASE COALESCE(t.rarity, b.rarity, 'common')
           WHEN 'legendary' THEN 800 WHEN 'epic' THEN 520 WHEN 'rare' THEN 320 WHEN 'uncommon' THEN 200 ELSE 120 END AS price
    FROM earned e
    LEFT JOIN card_templates t ON t.card_key = e.card_key
    -- The cards that were written in code and never in the table, with their rarity.
    LEFT JOIN (VALUES ('venom_edge', 'uncommon'), ('second_wind', 'uncommon'), ('hamstring', 'uncommon'), ('riposte', 'uncommon'), ('smoke_bomb', 'uncommon'),
                      ('shield_bash', 'rare'), ('bulwark', 'rare'), ('arrow_rain', 'rare'), ('battle_cry', 'rare'), ('last_stand', 'epic')) AS b(card_key, rarity)
           ON b.card_key = e.card_key
), paid AS (
  SELECT settlement_id, COUNT(*)::int AS cards, SUM(price)::int AS wealth FROM priced GROUP BY settlement_id
), pay AS (
  UPDATE settlements s SET wealth = s.wealth + p.wealth FROM paid p WHERE s.id = p.settlement_id RETURNING s.id
)
INSERT INTO settlement_events (settlement_id, type, message)
SELECT p.settlement_id, 'cards_retired',
       'Battles are fought on the board now, and the old battle cards are retired. For the '
       || p.cards || CASE WHEN p.cards = 1 THEN ' card' ELSE ' cards' END
       || ' your town had collected, it has been paid ' || p.wealth || ' wealth.'
  FROM paid p JOIN pay ON pay.id = p.settlement_id;

-- A battle left half-played with cards when they were removed starts again on the board (lib/tactics_quests.js
-- open does the same for one it meets): its card moves mean nothing now.
UPDATE settlement_quests SET combat_actions = '[]'::jsonb, combat_state = NULL
 WHERE status = 'active' AND combat_status IN ('pending', 'in_progress') AND jsonb_array_length(COALESCE(combat_actions, '[]'::jsonb)) > 0
   AND NOT EXISTS (SELECT 1 FROM tactics_battles b WHERE b.quest_run_id = settlement_quests.id);
