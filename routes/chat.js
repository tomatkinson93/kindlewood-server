// ══════════════════════════════════════════════════════════════════════════
//  CHAT HUB — channel-keyed forum + live chat (spec 016 §7, Phase 4)
//
//  Mounted at /api/chat. v1 has one channel per clan (kind 'clan'); global
//  community channels are a future row with kind 'global' (403 for now).
//
//  Access (one resolver): a clan channel is open to that clan's members,
//  and only once the clan reaches FORUM_UNLOCK_LEVEL (forum routes) or
//  CHAT_UNLOCK_LEVEL (live chat routes); below that → 403 { locked: true,
//  unlock_level }. Rank flags (post_forum, pin_forum, moderate) come from
//  the clan permission table.
//
//  SSE on clan:<id>: clan_chat (message inline), clan_chat_deleted,
//  clan_forum_updated (notify-then-fetch). Published after each write.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const eventBus = require('../lib/event_bus');
const palette = require('../lib/clan_palette');
const { checkClanPermission } = require('../lib/clan_permissions');
const { postMessage } = require('../lib/clan_chat');

const router = express.Router();

const LIMITS = { title: [3, 80], post: [1, 2000], chat: [1, 500] };
const THREADS_PAGE = 20, POSTS_PAGE = 30, MESSAGES_PAGE = 50, CATCHUP_MAX = 200;
const RATE = { lines: 5, windowMs: 10_000 };

class ChatError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
function sendError(res, e, fallback) {
  if (e instanceof ChatError) return res.status(e.status).json({ error: e.message, ...(e.extra || {}) });
  console.error(e);
  res.status(500).json({ error: fallback });
}

const parseId = v => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : null; };

// Trims, strips control characters (keeps newlines in forum posts), and
// enforces [min, max]. Returns the clean string or throws 400.
function cleanText(raw, [min, max], label, { multiline = false } = {}) {
  let s = String(raw == null ? '' : raw);
  s = multiline ? s.replace(/[^\S\n]+\n/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
                : s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  s = s.trim();
  if (multiline) s = s.replace(/\n{4,}/g, '\n\n\n');
  if (s.length < min) throw new ChatError(400, `${label} is too short.`);
  if (s.length > max) throw new ChatError(400, `${label} can be at most ${max} characters.`);
  return s;
}

// ── Access resolver ─────────────────────────────────────────────────────────
// area: 'forum' | 'chat'. Resolves { channel, clan, member } or throws.
async function resolveChannel(channelId, userId, area) {
  const ch = (await query('SELECT * FROM chat_channels WHERE id = $1', [channelId])).rows[0];
  if (!ch) throw new ChatError(404, 'Channel not found.');
  if (ch.kind !== 'clan') throw new ChatError(403, 'Community channels are coming soon.');
  const m = (await query(
    `SELECT cm.rank, c.id AS clan_id, c.level, c.name
       FROM clan_members cm JOIN clans c ON c.id = cm.clan_id
      WHERE cm.user_id = $1`, [userId])).rows[0];
  if (!m || m.clan_id !== ch.clan_id) throw new ChatError(403, "That is another clan's hall.");
  const need = area === 'chat' ? palette.CHAT_UNLOCK_LEVEL : palette.FORUM_UNLOCK_LEVEL;
  if (m.level < need) {
    throw new ChatError(403, `Your clan's ${area === 'chat' ? 'live chat' : 'forum'} unlocks at clan level ${need}.`,
      { locked: true, unlock_level: need });
  }
  return { channel: ch, clan: { id: m.clan_id, level: m.level, name: m.name }, member: { rank: m.rank } };
}

async function can(userId, flag) {
  const r = await checkClanPermission(userId, flag);
  return !!(r && r.allowed);
}

async function threadWithAccess(threadId, userId) {
  const th = (await query('SELECT * FROM forum_threads WHERE id = $1', [threadId])).rows[0];
  if (!th) throw new ChatError(404, 'Thread not found.');
  const acc = await resolveChannel(th.channel_id, userId, 'forum');
  return { thread: th, ...acc };
}

function forumUpdated(clanId, threadId, what) {
  eventBus.publish(`clan:${clanId}`, { type: 'clan_forum_updated', clan_id: clanId, thread_id: threadId || null, what });
}

// ── GET /api/chat/channels ──────────────────────────────────────────────────
router.get('/channels', requireAuth, async (req, res) => {
  try {
    const r = await query(
      `SELECT ch.id, ch.kind, ch.clan_id, c.name, c.level, c.banner, cm.rank,
              (SELECT MAX(id) FROM chat_messages m WHERE m.channel_id = ch.id) AS last_message_id,
              (SELECT MAX(last_post_at) FROM forum_threads t WHERE t.channel_id = ch.id) AS last_post_at
         FROM clan_members cm
         JOIN clans c ON c.id = cm.clan_id
         JOIN chat_channels ch ON ch.kind = 'clan' AND ch.clan_id = c.id
        WHERE cm.user_id = $1`, [req.user.userId]);
    const channels = [];
    for (const c of r.rows) {
      channels.push({
        id: c.id, kind: c.kind, clan_id: c.clan_id, name: c.name, level: c.level,
        banner: palette.resolveBanner(c.banner),
        forum: { unlocked: c.level >= palette.FORUM_UNLOCK_LEVEL, unlock_level: palette.FORUM_UNLOCK_LEVEL },
        chat: { unlocked: c.level >= palette.CHAT_UNLOCK_LEVEL, unlock_level: palette.CHAT_UNLOCK_LEVEL },
        last_message_id: c.last_message_id, last_post_at: c.last_post_at,
        permissions: {
          post_forum: await can(req.user.userId, 'post_forum'),
          pin_forum: await can(req.user.userId, 'pin_forum'),
          moderate: await can(req.user.userId, 'moderate'),
        },
      });
    }
    res.json({ ok: true, channels });
  } catch (e) {
    sendError(res, e, 'Failed to load channels.');
  }
});

// ── Forum ───────────────────────────────────────────────────────────────────

// GET /channels/:id/threads?before=<last_post_at ISO> — pinned first (page 1).
router.get('/channels/:id/threads', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad channel.' });
  try {
    await resolveChannel(id, req.user.userId, 'forum');
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && isNaN(before)) return res.status(400).json({ error: 'Bad cursor.' });
    const cols = `t.id, t.title, t.pinned, t.reply_count, t.last_post_at, t.created_at,
                  t.author_user_id, u.username AS author`;
    const pinned = before ? { rows: [] } : await query(
      `SELECT ${cols} FROM forum_threads t LEFT JOIN users u ON u.id = t.author_user_id
        WHERE t.channel_id = $1 AND t.pinned ORDER BY t.last_post_at DESC`, [id]);
    const rest = await query(
      `SELECT ${cols} FROM forum_threads t LEFT JOIN users u ON u.id = t.author_user_id
        WHERE t.channel_id = $1 AND NOT t.pinned AND ($2::timestamptz IS NULL OR t.last_post_at < $2)
        ORDER BY t.last_post_at DESC LIMIT $3`, [id, before, THREADS_PAGE]);
    res.json({ ok: true, threads: pinned.rows.concat(rest.rows), more: rest.rows.length === THREADS_PAGE });
  } catch (e) {
    sendError(res, e, 'Failed to load threads.');
  }
});

// POST /channels/:id/threads { title, body } — post_forum
router.post('/channels/:id/threads', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad channel.' });
  try {
    const { clan } = await resolveChannel(id, req.user.userId, 'forum');
    if (!(await can(req.user.userId, 'post_forum'))) throw new ChatError(403, 'Recruits can read the forum but not post yet.');
    const title = cleanText(req.body && req.body.title, LIMITS.title, 'Title');
    const body = cleanText(req.body && req.body.body, LIMITS.post, 'Post', { multiline: true });
    const threadId = await withTransaction(async (client) => {
      const t = await client.query(
        'INSERT INTO forum_threads (channel_id, author_user_id, title) VALUES ($1,$2,$3) RETURNING id',
        [id, req.user.userId, title]);
      await client.query(
        'INSERT INTO forum_posts (thread_id, author_user_id, body) VALUES ($1,$2,$3)', [t.rows[0].id, req.user.userId, body]);
      return t.rows[0].id;
    });
    forumUpdated(clan.id, threadId, 'thread_created');
    res.json({ ok: true, thread_id: threadId });
  } catch (e) {
    sendError(res, e, 'Could not start the thread.');
  }
});

// GET /threads/:id/posts?after=<post id> — 30 per page, oldest first.
router.get('/threads/:id/posts', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad thread.' });
  const after = parseId(req.query.after) || 0;
  try {
    const { thread } = await threadWithAccess(id, req.user.userId);
    const r = await query(
      `SELECT p.id, p.body, p.created_at, p.edited_at, p.author_user_id, u.username AS author
         FROM forum_posts p LEFT JOIN users u ON u.id = p.author_user_id
        WHERE p.thread_id = $1 AND p.id > $2 ORDER BY p.id LIMIT $3`, [id, after, POSTS_PAGE]);
    const first = (await query('SELECT MIN(id) AS id FROM forum_posts WHERE thread_id = $1', [id])).rows[0].id;
    const au = thread.author_user_id
      ? (await query('SELECT username FROM users WHERE id = $1', [thread.author_user_id])).rows[0] : null;
    res.json({
      ok: true,
      thread: { id: thread.id, title: thread.title, pinned: thread.pinned, reply_count: thread.reply_count,
                author_user_id: thread.author_user_id, author: au ? au.username : null, first_post_id: first,
                created_at: thread.created_at, channel_id: thread.channel_id },
      posts: r.rows, more: r.rows.length === POSTS_PAGE,
    });
  } catch (e) {
    sendError(res, e, 'Failed to load the thread.');
  }
});

// POST /threads/:id/posts { body } — post_forum
router.post('/threads/:id/posts', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad thread.' });
  try {
    const { clan } = await threadWithAccess(id, req.user.userId);
    if (!(await can(req.user.userId, 'post_forum'))) throw new ChatError(403, 'Recruits can read the forum but not post yet.');
    const body = cleanText(req.body && req.body.body, LIMITS.post, 'Reply', { multiline: true });
    const postId = await withTransaction(async (client) => {
      const p = await client.query(
        'INSERT INTO forum_posts (thread_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING id', [id, req.user.userId, body]);
      await client.query(
        'UPDATE forum_threads SET reply_count = reply_count + 1, last_post_at = NOW() WHERE id = $1', [id]);
      return p.rows[0].id;
    });
    forumUpdated(clan.id, id, 'reply');
    res.json({ ok: true, post_id: postId });
  } catch (e) {
    sendError(res, e, 'Could not post the reply.');
  }
});

// Loads a post with its thread and checks author-or-moderate.
async function editablePost(postId, userId) {
  const p = (await query('SELECT * FROM forum_posts WHERE id = $1', [postId])).rows[0];
  if (!p) throw new ChatError(404, 'Post not found.');
  const acc = await threadWithAccess(p.thread_id, userId);
  if (p.author_user_id !== userId && !(await can(userId, 'moderate'))) {
    throw new ChatError(403, 'Only the author or a moderator can change this post.');
  }
  return { post: p, ...acc };
}

// PATCH /posts/:id { body } — author or moderate
router.patch('/posts/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad post.' });
  try {
    const { clan, thread } = await editablePost(id, req.user.userId);
    const body = cleanText(req.body && req.body.body, LIMITS.post, 'Post', { multiline: true });
    await query('UPDATE forum_posts SET body = $2, edited_at = NOW() WHERE id = $1', [id, body]);
    forumUpdated(clan.id, thread.id, 'edited');
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not edit the post.');
  }
});

// DELETE /posts/:id — author or moderate. The opening post goes with its
// thread (DELETE /threads/:id).
router.delete('/posts/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad post.' });
  try {
    const { clan, thread } = await editablePost(id, req.user.userId);
    const first = (await query('SELECT MIN(id) AS id FROM forum_posts WHERE thread_id = $1', [thread.id])).rows[0].id;
    if (first === id) throw new ChatError(400, 'That is the opening post — delete the thread instead.');
    await withTransaction(async (client) => {
      await client.query('DELETE FROM forum_posts WHERE id = $1', [id]);
      await client.query('UPDATE forum_threads SET reply_count = GREATEST(0, reply_count - 1) WHERE id = $1', [thread.id]);
    });
    forumUpdated(clan.id, thread.id, 'post_deleted');
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not delete the post.');
  }
});

// POST /threads/:id/pin { pinned } — pin_forum
router.post('/threads/:id/pin', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad thread.' });
  try {
    const { clan } = await threadWithAccess(id, req.user.userId);
    if (!(await can(req.user.userId, 'pin_forum'))) throw new ChatError(403, 'Your rank cannot pin threads.');
    const pinned = !!(req.body && req.body.pinned);
    await query('UPDATE forum_threads SET pinned = $2 WHERE id = $1', [id, pinned]);
    forumUpdated(clan.id, id, pinned ? 'pinned' : 'unpinned');
    res.json({ ok: true, pinned });
  } catch (e) {
    sendError(res, e, 'Could not pin the thread.');
  }
});

// DELETE /threads/:id — author while it has no replies, or moderate
router.delete('/threads/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad thread.' });
  try {
    const { thread, clan } = await threadWithAccess(id, req.user.userId);
    const mod = await can(req.user.userId, 'moderate');
    const ownEmpty = thread.author_user_id === req.user.userId && thread.reply_count === 0;
    if (!mod && !ownEmpty) {
      throw new ChatError(403, thread.author_user_id === req.user.userId
        ? 'Threads with replies can only be removed by a moderator.'
        : 'Only the author or a moderator can delete this thread.');
    }
    await query('DELETE FROM forum_threads WHERE id = $1', [id]);
    forumUpdated(clan.id, id, 'thread_deleted');
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not delete the thread.');
  }
});

// ── Live chat ───────────────────────────────────────────────────────────────

// GET /channels/:id/messages?before=<id> → 50 older; ?after=<id> → all newer
// (≤200, reconnect catch-up); neither → newest 50. Always oldest-first.
router.get('/channels/:id/messages', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad channel.' });
  const before = parseId(req.query.before), after = req.query.after !== undefined ? (parseInt(req.query.after, 10) || 0) : null;
  try {
    await resolveChannel(id, req.user.userId, 'chat');
    const cols = `m.id, m.channel_id, m.author_user_id, u.username AS author, m.body, m.created_at`;
    let rows;
    if (after !== null) {
      rows = (await query(
        `SELECT ${cols} FROM chat_messages m LEFT JOIN users u ON u.id = m.author_user_id
          WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id LIMIT $3`, [id, after, CATCHUP_MAX])).rows;
    } else {
      rows = (await query(
        `SELECT ${cols} FROM chat_messages m LEFT JOIN users u ON u.id = m.author_user_id
          WHERE m.channel_id = $1 AND ($2::int IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`,
        [id, before, MESSAGES_PAGE])).rows.reverse();
    }
    res.json({
      ok: true,
      messages: rows.map(m => ({ ...m, system: m.author_user_id === null })),
      more: after === null && rows.length === MESSAGES_PAGE,
    });
  } catch (e) {
    sendError(res, e, 'Failed to load messages.');
  }
});

// In-memory send rate limit: RATE.lines per RATE.windowMs per user (single
// Node process, like the event bus).
const _recent = new Map();   // userId → [timestamps]
function rateLimited(userId, now = Date.now()) {
  const list = (_recent.get(userId) || []).filter(t => now - t < RATE.windowMs);
  if (list.length >= RATE.lines) { _recent.set(userId, list); return true; }
  list.push(now);
  _recent.set(userId, list);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _recent) if (!v.some(t => now - t < RATE.windowMs)) _recent.delete(k);
}, 60_000).unref();

// POST /channels/:id/messages { body } — any member, recruits included
router.post('/channels/:id/messages', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad channel.' });
  try {
    const { clan } = await resolveChannel(id, req.user.userId, 'chat');
    const body = cleanText(req.body && req.body.body, LIMITS.chat, 'Message');
    if (rateLimited(req.user.userId)) {
      return res.status(429).json({ error: 'Easy there — a moment before your next message.' });
    }
    const msg = await postMessage(clan.id, id, req.user.userId, req.user.username, body);
    res.json({ ok: true, message: msg });
  } catch (e) {
    sendError(res, e, 'Could not send the message.');
  }
});

// DELETE /messages/:id — moderate
router.delete('/messages/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad message.' });
  try {
    const m = (await query('SELECT * FROM chat_messages WHERE id = $1', [id])).rows[0];
    if (!m) throw new ChatError(404, 'Message not found.');
    const { clan } = await resolveChannel(m.channel_id, req.user.userId, 'chat');
    if (!(await can(req.user.userId, 'moderate'))) throw new ChatError(403, 'Only moderators can remove messages.');
    await query('DELETE FROM chat_messages WHERE id = $1', [id]);
    eventBus.publish(`clan:${clan.id}`, { type: 'clan_chat_deleted', clan_id: clan.id, message_id: id });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not remove the message.');
  }
});

router._test = { rateLimited, cleanText, RATE };
module.exports = router;
