// ══════════════════════════════════════════════════════════════════════════
//  CLAN CHAT — shared helpers for the Chat hub's live chat (spec 016 §7)
//
//  postMessage() inserts a line, keeps the channel's backlog near the newest
//  200 rows, and publishes clan_chat (message inline) on clan:<id>.
//  systemLine() posts an author-less line for clan events (joins, claims,
//  level-ups) — written from founding onward, so the backlog already has
//  history when live chat unlocks at level 4. Call both AFTER the COMMIT of
//  whatever caused them.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const { query } = require('../db');
const eventBus = require('./event_bus');

const BACKLOG_KEEP = 200;
const BACKLOG_PRUNE_AT = 250;

async function clanChannelId(clanId) {
  const r = await query("SELECT id FROM chat_channels WHERE kind = 'clan' AND clan_id = $1", [clanId]);
  return r.rows[0] ? r.rows[0].id : null;
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

function toWire(row, author) {
  return {
    id: row.id, channel_id: row.channel_id, author_user_id: row.author_user_id,
    author: author || null, body: row.body, created_at: row.created_at, system: row.author_user_id === null,
  };
}

// Inserts a message (authorUserId null = system line) and fans it out.
async function postMessage(clanId, channelId, authorUserId, authorName, body) {
  const r = await query(
    'INSERT INTO chat_messages (channel_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING *',
    [channelId, authorUserId, body]);
  const msg = toWire(r.rows[0], authorName);
  eventBus.publish(`clan:${clanId}`, { type: 'clan_chat', clan_id: clanId, message: msg });
  pruneBacklog(channelId).catch(e => console.error('[clan_chat] prune failed', e));
  return msg;
}

// Fire-and-forget system line; never throws into the caller.
function systemLine(clanId, body) {
  return clanChannelId(clanId)
    .then(ch => (ch ? postMessage(clanId, ch, null, null, body) : null))
    .catch(e => { console.error('[clan_chat] system line failed', e); return null; });
}

module.exports = { clanChannelId, postMessage, systemLine, pruneBacklog, toWire, BACKLOG_KEEP };
