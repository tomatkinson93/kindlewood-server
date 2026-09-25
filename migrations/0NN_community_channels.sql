-- 0NN_community_channels.sql — realm-wide forum boards + live chat in the Chat hub
-- Additive on top of 0NN_chat_hub.sql: community channels are chat_channels
-- rows with kind = 'global'. Idempotent; db.js initDB() re-applies it on
-- every boot (matched by the `_community_channels.sql` suffix).
BEGIN;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS slug        TEXT;
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS icon        TEXT NOT NULL DEFAULT '';
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS sort_order  INTEGER NOT NULL DEFAULT 0;
-- Which surfaces the channel has: 'forum', 'chat' or 'both' (clan halls).
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS features    TEXT NOT NULL DEFAULT 'both';
-- Who may start threads: 'open' (anyone with access) or 'staff' (admins —
-- e.g. Announcements; anyone may still reply).
ALTER TABLE chat_channels ADD COLUMN IF NOT EXISTS post_policy TEXT NOT NULL DEFAULT 'open';
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_slug_uniq ON chat_channels (slug) WHERE slug IS NOT NULL;

-- Seed the realm's boards and chat. ON CONFLICT keeps admin edits to
-- existing rows; new boards are added by inserting another row.
INSERT INTO chat_channels (kind, slug, name, description, icon, sort_order, features, post_policy) VALUES
  ('global', 'announcements', 'Announcements',     'News and updates from the Kindlewood team.',         '📢', 10, 'forum', 'staff'),
  ('global', 'general',       'General',           'Anything Kindlewood — say hello, share your realm.', '💬', 20, 'forum', 'open'),
  ('global', 'trade',         'Trade',             'Buy, sell and barter resources and goods.',          '⚖️', 30, 'forum', 'open'),
  ('global', 'help',          'Help & Questions',  'Stuck? Ask the realm — no question too small.',      '❓', 40, 'forum', 'open'),
  ('global', 'suggestions',   'Suggestions',       'Ideas to make Kindlewood better.',                   '💡', 50, 'forum', 'open'),
  ('global', 'tavern',        'Tavern Talk',       'Off-topic chatter by the fire.',                     '🍺', 60, 'forum', 'open'),
  ('global', 'realm-chat',    'Realm Chat',        'Live chat open to every ruler in the realm.',        '🔥', 5,  'chat',  'open')
ON CONFLICT DO NOTHING;
COMMIT;
