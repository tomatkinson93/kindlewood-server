// ══════════════════════════════════════════════════════════════════════════
//  CHAT — shared helpers for the Chat hub's live chat (spec 016 §7)
//
//  Serves both kinds of channel:
//    clan   → events on clan:<id>  as clan_chat / clan_chat_deleted /
//             clan_forum_updated
//    global → events on "global"   as chat_message / chat_message_deleted /
//             forum_updated (every SSE connection subscribes to "global")
//
//  postMessage() inserts a line, keeps the channel's backlog near the newest
//  200 rows, and publishes it inline with the author's clan tag.
//  systemLine() posts an author-less line into a clan's channel for clan
//  events (joins, claims, level-ups) — written from founding onward, so the
//  backlog already has history when clan live chat unlocks at level 4.
//  Call both AFTER the COMMIT of whatever caused them.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('../db');
const eventBus = require('./event_bus');
const palette = require('./clan_palette');
const { staffFor } = require('./moderation');

const BACKLOG_KEEP = 200;
const BACKLOG_PRUNE_AT = 250;

// Where a channel's live events go, and what they're called.
function eventTarget(ch) {
  return ch.kind === 'clan'
    ? { key: `clan:${ch.clan_id}`, extra: { clan_id: ch.clan_id },
        types: { message: 'clan_chat', deleted: 'clan_chat_deleted', forum: 'clan_forum_updated' } }
    : { key: 'global', extra: {},
        types: { message: 'chat_message', deleted: 'chat_message_deleted', forum: 'forum_updated' } };
}

function publish(ch, kind, payload) {
  const t = eventTarget(ch);
  eventBus.publish(t.key, { type: t.types[kind], channel_id: ch.id, ...t.extra, ...payload });
}

async function clanChannel(clanId) {
  const r = await query("SELECT * FROM chat_channels WHERE kind = 'clan' AND clan_id = $1", [clanId]);
  return r.rows[0] || null;
}

// Author's clan tag ({ name, primary, glyph }) or null.
async function authorClan(userId) {
  if (!userId) return null;
  const r = await query(
    `SELECT c.id, c.name, c.banner FROM clan_members cm JOIN clans c ON c.id = cm.clan_id WHERE cm.user_id = $1`, [userId]);
  if (!r.rows[0]) return null;
  const b = palette.resolveBanner(r.rows[0].banner);
  return { id: r.rows[0].id, name: r.rows[0].name, primary: b.primaryHex, glyph: b.glyph };
}

// SQL fragment + mapper that add author_clan and author_staff ('admin' |
// 'moderator' | null, for the MOD/ADMIN badge) to message/post rows.
const AUTHOR_CLAN_SQL = `
  LEFT JOIN clan_members acm ON acm.user_id = %ALIAS%.author_user_id
  LEFT JOIN clans ac ON ac.id = acm.clan_id
  LEFT JOIN users asu ON asu.id = %ALIAS%.author_user_id`;
const AUTHOR_CLAN_COLS = 'ac.id AS author_clan_id, ac.name AS author_clan_name, ac.banner AS author_clan_banner, asu.site_role AS author_site_role';
function withAuthorClan(row) {
  const { author_clan_id, author_clan_name, author_clan_banner, author_site_role, ...rest } = row;
  const author_staff = staffFor(row.author_user_id, author_site_role);
  if (!author_clan_name) return { ...rest, author_clan: null, author_staff };
  const b = palette.resolveBanner(author_clan_banner);
  return { ...rest, author_clan: { id: author_clan_id, name: author_clan_name, primary: b.primaryHex, glyph: b.glyph }, author_staff };
}

async function authorStaff(userId) {
  if (!userId) return null;
  const r = await query('SELECT site_role FROM users WHERE id = $1', [userId]);
  return staffFor(userId, r.rows[0] && r.rows[0].site_role);
}

// Deletes all but the newest BACKLOG_KEEP rows once the channel passes
// BACKLOG_PRUNE_AT, so pruning runs in batches rather than on every insert.
async function pruneBacklog(channelId) {
  const n = (await query('SELECT COUNT(*)::int AS n FROM chat_messages WHERE channel_id = $1', [channelId])).rows[0].n;
  if (n <= BACKLOG_PRUNE_AT) return 0;
  const r = await query(
    `DELETE FROM chat_messages WHERE channel_id = $1 AND id < (
       SELECT id FROM chat_messages WHERE channel_id = $1 ORDER BY id DESC OFFSET $2 LIMIT 1)`,
    [channelId, BACKLOG_KEEP - 1]);
  return r.rowCount;
}

// Inserts a message into channel row `ch` (authorUserId null = system line)
// and fans it out.
async function postMessage(ch, authorUserId, authorName, body) {
  const r = await query(
    'INSERT INTO chat_messages (channel_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING *',
    [ch.id, authorUserId, body]);
  const row = r.rows[0];
  const msg = {
    id: row.id, channel_id: row.channel_id, author_user_id: row.author_user_id,
    author: authorName || null, author_clan: await authorClan(authorUserId),
    author_staff: await authorStaff(authorUserId),
    body: row.body, created_at: row.created_at, system: row.author_user_id === null,
  };
  publish(ch, 'message', { message: msg });
  pruneBacklog(ch.id).catch(e => console.error('[chat] prune failed', e));
  return msg;
}

// Fire-and-forget clan system line; never throws into the caller.
function systemLine(clanId, body) {
  return clanChannel(clanId)
    .then(ch => (ch ? postMessage(ch, null, null, body) : null))
    .catch(e => { console.error('[chat] system line failed', e); return null; });
}

module.exports = {
  eventTarget, publish, clanChannel, postMessage, systemLine, pruneBacklog,
  AUTHOR_CLAN_SQL, AUTHOR_CLAN_COLS, withAuthorClan, BACKLOG_KEEP,
};
