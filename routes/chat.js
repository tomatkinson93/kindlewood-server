// ══════════════════════════════════════════════════════════════════════════
//  CHAT HUB — channel-keyed forum + live chat (spec 016 §7, Phase 4)
//
//  Mounted at /api/chat. Two kinds of channel share every route:
//    clan   — one per clan, its private hall (forum + live chat)
//    global — realm-wide boards (Announcements, General, Trade, …) and
//             Realm Chat; `features` says whether a channel has a forum,
//             live chat or both.
//
//  Access (one resolver, resolveChannel):
//    clan   → that clan's members only, and only once the clan reaches
//             FORUM_UNLOCK_LEVEL (forum) / CHAT_UNLOCK_LEVEL (live chat);
//             below that → 403 { locked: true, unlock_level }. Rank flags
//             (post_forum, pin_forum, moderate) come from the rank table.
//    global → every signed-in player reads and posts; threads on 'staff'
//             boards (Announcements) are staff-only, replies are open;
//             staff (admins + moderators, lib/moderation.js) pin and
//             moderate. Muted players read but cannot post.
//
//  Reports: any player may report someone else's message or post in a
//  channel they can read. Staff work the queue (GET /reports) and resolve
//  a report by dismissing it, removing the content, or removing it and
//  muting the author — every action lands in mod_actions.
//
//  SSE (lib/clan_chat.js eventTarget): clan events on clan:<id>, global
//  events on "global". Chat lines inline; forum changes notify-then-fetch.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const eventBus = require('../lib/event_bus');
const palette = require('../lib/clan_palette');
const { checkClanPermission } = require('../lib/clan_permissions');
const { isAdminUser, requireAdmin } = require('../middleware/admin');
const mod = require('../lib/moderation');
const { postMessage, publish, AUTHOR_CLAN_SQL, AUTHOR_CLAN_COLS, withAuthorClan } = require('../lib/clan_chat');

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
// area: 'forum' | 'chat'. Resolves { channel, clan, perms } or throws.
// perms: { post_thread, post_reply, pin, moderate } for this viewer.
const hasArea = (ch, area) => ch.features === 'both' || ch.features === area;

const globalPerms = (ch, staff) =>
  ({ post_thread: ch.post_policy !== 'staff' || staff, post_reply: true, pin: staff, moderate: staff });

// Realm channels only: a muted player cannot write.
async function assertNotMuted(channel, user) {
  if (channel.kind !== 'global') return;
  const m = await mod.activeMute(user.userId);
  if (m) throw new ChatError(403, mod.muteMessage(m), { muted: true, muted_until: m.until });
}

async function clanFlag(userId, flag) {
  const r = await checkClanPermission(userId, flag);
  return !!(r && r.allowed);
}

async function resolveChannel(channelId, user, area) {
  const ch = (await query('SELECT * FROM chat_channels WHERE id = $1', [channelId])).rows[0];
  if (!ch) throw new ChatError(404, 'Channel not found.');
  if (area && !hasArea(ch, area)) {
    throw new ChatError(404, area === 'chat' ? 'That board has no live chat.' : 'That channel has no forum.');
  }
  if (ch.kind === 'global') {
    const staff = !!(await mod.staffRole(user));
    return { channel: ch, clan: null, perms: globalPerms(ch, staff) };
  }
  const m = (await query(
    `SELECT cm.rank, c.id AS clan_id, c.level, c.name
       FROM clan_members cm JOIN clans c ON c.id = cm.clan_id
      WHERE cm.user_id = $1`, [user.userId])).rows[0];
  if (!m || m.clan_id !== ch.clan_id) throw new ChatError(403, "That is another clan's hall.");
  const need = area === 'chat' ? palette.CHAT_UNLOCK_LEVEL : palette.FORUM_UNLOCK_LEVEL;
  if (area && m.level < need) {
    throw new ChatError(403, `Your clan's ${area === 'chat' ? 'live chat' : 'forum'} unlocks at clan level ${need}.`,
      { locked: true, unlock_level: need });
  }
  const post = await clanFlag(user.userId, 'post_forum');
  return {
    channel: ch, clan: { id: m.clan_id, level: m.level, name: m.name },
    perms: { post_thread: post, post_reply: post, pin: await clanFlag(user.userId, 'pin_forum'),
             moderate: await clanFlag(user.userId, 'moderate') },
  };
}

// Why a clan-hall write was refused (recruits) vs a staff-only board.
function noPostReason(ch) {
  return ch.kind === 'global'
    ? 'Only the Kindlewood team can start threads here — reply to one instead.'
    : 'Recruits can read the forum but not post yet.';
}

async function threadWithAccess(threadId, user) {
  const th = (await query('SELECT * FROM forum_threads WHERE id = $1', [threadId])).rows[0];
  if (!th) throw new ChatError(404, 'Thread not found.');
  const acc = await resolveChannel(th.channel_id, user, 'forum');
  return { thread: th, ...acc };
}

// Staff acting on someone else's realm content goes in the audit log.
async function auditStaffAct(channel, user, authorUserId, action, detail) {
  if (channel.kind !== 'global' || authorUserId === user.userId) return;
  await mod.logModAction({ query }, user.userId, action, authorUserId, { channel_id: channel.id, ...detail });
}

function forumUpdated(ch, threadId, what) {
  publish(ch, 'forum', { thread_id: threadId || null, what });
}

// ── GET /api/chat/channels ──────────────────────────────────────────────────
//  The viewer's clan hall (if any) followed by the realm's channels.
router.get('/channels', requireAuth, async (req, res) => {
  try {
    const stats = `(SELECT MAX(id) FROM chat_messages m WHERE m.channel_id = ch.id) AS last_message_id,
                   (SELECT MAX(last_post_at) FROM forum_threads t WHERE t.channel_id = ch.id) AS last_post_at,
                   (SELECT COUNT(*)::int FROM forum_threads t WHERE t.channel_id = ch.id) AS thread_count`;
    const clanRows = (await query(
      `SELECT ch.*, c.name AS clan_name, c.level, c.banner, c.prestige_lifetime, cm.rank, ${stats}
         FROM clan_members cm
         JOIN clans c ON c.id = cm.clan_id
         JOIN chat_channels ch ON ch.kind = 'clan' AND ch.clan_id = c.id
        WHERE cm.user_id = $1`, [req.user.userId])).rows;
    const globalRows = (await query(
      `SELECT ch.*, ${stats} FROM chat_channels ch WHERE ch.kind = 'global' ORDER BY ch.sort_order, ch.id`)).rows;

    const channels = [];
    for (const c of clanRows) {
      const { perms } = await resolveChannel(c.id, req.user, null);
      channels.push({
        id: c.id, kind: 'clan', clan_id: c.clan_id, name: c.clan_name, level: c.level,
        prestige_lifetime: Number(c.prestige_lifetime), rank: c.rank,
        banner: palette.resolveBanner(c.banner),
        features: c.features || 'both',
        forum: { unlocked: c.level >= palette.FORUM_UNLOCK_LEVEL, unlock_level: palette.FORUM_UNLOCK_LEVEL },
        chat: { unlocked: c.level >= palette.CHAT_UNLOCK_LEVEL, unlock_level: palette.CHAT_UNLOCK_LEVEL },
        last_message_id: c.last_message_id, last_post_at: c.last_post_at, thread_count: c.thread_count,
        permissions: { post_forum: perms.post_thread, post_reply: perms.post_reply, pin_forum: perms.pin, moderate: perms.moderate },
      });
    }
    const staff = await mod.staffRole(req.user);
    const muted = await mod.activeMute(req.user.userId);
    const openReports = staff
      ? (await query("SELECT COUNT(*)::int AS n FROM chat_reports WHERE status = 'open'")).rows[0].n : 0;
    for (const c of globalRows) {
      const perms = globalPerms(c, !!staff);
      channels.push({
        id: c.id, kind: 'global', slug: c.slug, name: c.name, description: c.description, icon: c.icon,
        features: c.features, post_policy: c.post_policy,
        forum: { unlocked: hasArea(c, 'forum') }, chat: { unlocked: hasArea(c, 'chat') },
        last_message_id: c.last_message_id, last_post_at: c.last_post_at, thread_count: c.thread_count,
        permissions: { post_forum: perms.post_thread, post_reply: true, pin_forum: perms.pin, moderate: perms.moderate },
      });
    }
    res.json({
      ok: true, channels, admin: isAdminUser(req.user), staff,
      muted: muted ? { until: muted.until } : null, open_reports: openReports,
    });
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
    await resolveChannel(id, req.user, 'forum');
    const before = req.query.before ? new Date(String(req.query.before)) : null;
    if (before && isNaN(before)) return res.status(400).json({ error: 'Bad cursor.' });
    const cols = `t.id, t.title, t.pinned, t.reply_count, t.last_post_at, t.created_at,
                  t.author_user_id, u.username AS author, ${AUTHOR_CLAN_COLS}`;
    const from = `forum_threads t LEFT JOIN users u ON u.id = t.author_user_id ${AUTHOR_CLAN_SQL.replace(/%ALIAS%/g, 't')}`;
    const pinned = before ? { rows: [] } : await query(
      `SELECT ${cols} FROM ${from} WHERE t.channel_id = $1 AND t.pinned ORDER BY t.last_post_at DESC`, [id]);
    const rest = await query(
      `SELECT ${cols} FROM ${from}
        WHERE t.channel_id = $1 AND NOT t.pinned AND ($2::timestamptz IS NULL OR t.last_post_at < $2)
        ORDER BY t.last_post_at DESC LIMIT $3`, [id, before, THREADS_PAGE]);
    res.json({ ok: true, threads: pinned.rows.concat(rest.rows).map(withAuthorClan), more: rest.rows.length === THREADS_PAGE });
  } catch (e) {
    sendError(res, e, 'Failed to load threads.');
  }
});

// POST /channels/:id/threads { title, body }
router.post('/channels/:id/threads', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad channel.' });
  try {
    const { channel, perms } = await resolveChannel(id, req.user, 'forum');
    if (!perms.post_thread) throw new ChatError(403, noPostReason(channel));
    await assertNotMuted(channel, req.user);
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
    forumUpdated(channel, threadId, 'thread_created');
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
    const { thread } = await threadWithAccess(id, req.user);
    const r = await query(
      `SELECT p.id, p.body, p.created_at, p.edited_at, p.author_user_id, u.username AS author, ${AUTHOR_CLAN_COLS}
         FROM forum_posts p LEFT JOIN users u ON u.id = p.author_user_id ${AUTHOR_CLAN_SQL.replace(/%ALIAS%/g, 'p')}
        WHERE p.thread_id = $1 AND p.id > $2 ORDER BY p.id LIMIT $3`, [id, after, POSTS_PAGE]);
    const first = (await query('SELECT MIN(id) AS id FROM forum_posts WHERE thread_id = $1', [id])).rows[0].id;
    const au = thread.author_user_id
      ? (await query('SELECT username FROM users WHERE id = $1', [thread.author_user_id])).rows[0] : null;
    res.json({
      ok: true,
      thread: { id: thread.id, title: thread.title, pinned: thread.pinned, reply_count: thread.reply_count,
                author_user_id: thread.author_user_id, author: au ? au.username : null, first_post_id: first,
                created_at: thread.created_at, channel_id: thread.channel_id },
      posts: r.rows.map(withAuthorClan), more: r.rows.length === POSTS_PAGE,
    });
  } catch (e) {
    sendError(res, e, 'Failed to load the thread.');
  }
});

// POST /threads/:id/posts { body }
router.post('/threads/:id/posts', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad thread.' });
  try {
    const { channel, perms } = await threadWithAccess(id, req.user);
    if (!perms.post_reply) throw new ChatError(403, noPostReason(channel));
    await assertNotMuted(channel, req.user);
    const body = cleanText(req.body && req.body.body, LIMITS.post, 'Reply', { multiline: true });
    const postId = await withTransaction(async (client) => {
      const p = await client.query(
        'INSERT INTO forum_posts (thread_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING id', [id, req.user.userId, body]);
      await client.query(
        'UPDATE forum_threads SET reply_count = reply_count + 1, last_post_at = NOW() WHERE id = $1', [id]);
      return p.rows[0].id;
    });
    forumUpdated(channel, id, 'reply');
    res.json({ ok: true, post_id: postId });
  } catch (e) {
    sendError(res, e, 'Could not post the reply.');
  }
});

// Loads a post with its thread and checks author-or-moderate.
async function editablePost(postId, user) {
  const p = (await query('SELECT * FROM forum_posts WHERE id = $1', [postId])).rows[0];
  if (!p) throw new ChatError(404, 'Post not found.');
  const acc = await threadWithAccess(p.thread_id, user);
  if (p.author_user_id !== user.userId && !acc.perms.moderate) {
    throw new ChatError(403, 'Only the author or a moderator can change this post.');
  }
  return { post: p, ...acc };
}

// PATCH /posts/:id { body } — author or moderate
router.patch('/posts/:id', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad post.' });
  try {
    const { channel, thread } = await editablePost(id, req.user);
    await assertNotMuted(channel, req.user);
    const body = cleanText(req.body && req.body.body, LIMITS.post, 'Post', { multiline: true });
    await query('UPDATE forum_posts SET body = $2, edited_at = NOW() WHERE id = $1', [id, body]);
    forumUpdated(channel, thread.id, 'edited');
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
    const { channel, thread, post } = await editablePost(id, req.user);
    const first = (await query('SELECT MIN(id) AS id FROM forum_posts WHERE thread_id = $1', [thread.id])).rows[0].id;
    if (first === id) throw new ChatError(400, 'That is the opening post — delete the thread instead.');
    await deletePost(id, thread.id);
    await auditStaffAct(channel, req.user, post.author_user_id, 'remove_post', { post_id: id, thread_id: thread.id, body: post.body });
    forumUpdated(channel, thread.id, 'post_deleted');
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not delete the post.');
  }
});

async function deletePost(postId, threadId) {
  await withTransaction(async (client) => {
    const d = await client.query('DELETE FROM forum_posts WHERE id = $1', [postId]);
    if (d.rowCount) {
      await client.query('UPDATE forum_threads SET reply_count = GREATEST(0, reply_count - 1) WHERE id = $1', [threadId]);
    }
  });
}

// POST /threads/:id/pin { pinned }
router.post('/threads/:id/pin', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad thread.' });
  try {
    const { channel, perms } = await threadWithAccess(id, req.user);
    if (!perms.pin) throw new ChatError(403, 'You cannot pin threads here.');
    const pinned = !!(req.body && req.body.pinned);
    await query('UPDATE forum_threads SET pinned = $2 WHERE id = $1', [id, pinned]);
    if (channel.kind === 'global') {
      await mod.logModAction({ query }, req.user.userId, pinned ? 'pin_thread' : 'unpin_thread', null, { thread_id: id });
    }
    forumUpdated(channel, id, pinned ? 'pinned' : 'unpinned');
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
    const { thread, channel, perms } = await threadWithAccess(id, req.user);
    const ownEmpty = thread.author_user_id === req.user.userId && thread.reply_count === 0;
    if (!perms.moderate && !ownEmpty) {
      throw new ChatError(403, thread.author_user_id === req.user.userId
        ? 'Threads with replies can only be removed by a moderator.'
        : 'Only the author or a moderator can delete this thread.');
    }
    await query('DELETE FROM forum_threads WHERE id = $1', [id]);
    await auditStaffAct(channel, req.user, thread.author_user_id, 'remove_thread', { thread_id: id, title: thread.title });
    forumUpdated(channel, id, 'thread_deleted');
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
    await resolveChannel(id, req.user, 'chat');
    const cols = `m.id, m.channel_id, m.author_user_id, u.username AS author, m.body, m.created_at, ${AUTHOR_CLAN_COLS}`;
    const from = `chat_messages m LEFT JOIN users u ON u.id = m.author_user_id ${AUTHOR_CLAN_SQL.replace(/%ALIAS%/g, 'm')}`;
    let rows;
    if (after !== null) {
      rows = (await query(
        `SELECT ${cols} FROM ${from} WHERE m.channel_id = $1 AND m.id > $2 ORDER BY m.id LIMIT $3`,
        [id, after, CATCHUP_MAX])).rows;
    } else {
      rows = (await query(
        `SELECT ${cols} FROM ${from} WHERE m.channel_id = $1 AND ($2::int IS NULL OR m.id < $2) ORDER BY m.id DESC LIMIT $3`,
        [id, before, MESSAGES_PAGE])).rows.reverse();
    }
    res.json({
      ok: true,
      messages: rows.map(m => ({ ...withAuthorClan(m), system: m.author_user_id === null })),
      more: after === null && rows.length === MESSAGES_PAGE,
    });
  } catch (e) {
    sendError(res, e, 'Failed to load messages.');
  }
});

// In-memory send rate limit: RATE.lines per RATE.windowMs per user across
// all channels (single Node process, like the event bus).
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

// POST /channels/:id/messages { body } — anyone with access (clan recruits
// included)
router.post('/channels/:id/messages', requireAuth, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad channel.' });
  try {
    const { channel } = await resolveChannel(id, req.user, 'chat');
    await assertNotMuted(channel, req.user);
    const body = cleanText(req.body && req.body.body, LIMITS.chat, 'Message');
    if (rateLimited(req.user.userId)) {
      return res.status(429).json({ error: 'Easy there — a moment before your next message.' });
    }
    const msg = await postMessage(channel, req.user.userId, req.user.username, body);
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
    const { channel, perms } = await resolveChannel(m.channel_id, req.user, 'chat');
    if (!perms.moderate) throw new ChatError(403, 'Only moderators can remove messages.');
    await query('DELETE FROM chat_messages WHERE id = $1', [id]);
    await auditStaffAct(channel, req.user, m.author_user_id, 'remove_message', { message_id: id, body: m.body });
    publish(channel, 'deleted', { message_id: id });
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not remove the message.');
  }
});

// ══════════════════════════════════════════════════════════════════════════
//  Moderation: reports, mutes, staff
// ══════════════════════════════════════════════════════════════════════════

const REPORT_REASONS = ['spam', 'abuse', 'inappropriate', 'other'];
const REPORTS_PER_HOUR = 20;

async function requireStaff(req, res, next) {
  try {
    req.staff = await mod.staffRole(req.user);
    if (!req.staff) return res.status(403).json({ error: 'Moderators only.' });
    next();
  } catch (e) { sendError(res, e, 'Could not check your role.'); }
}

async function openReportCount() {
  return (await query("SELECT COUNT(*)::int AS n FROM chat_reports WHERE status = 'open'")).rows[0].n;
}
async function notifyStaff(extra) {
  eventBus.publish('staff', { type: 'mod_reports', open_reports: await openReportCount(), ...(extra || {}) });
}

// The reported thing, wherever it lives: { channel_id, thread_id, author_user_id, body, is_opening }.
async function loadTarget(type, id) {
  if (type === 'message') {
    const m = (await query('SELECT * FROM chat_messages WHERE id = $1', [id])).rows[0];
    return m && { channel_id: m.channel_id, thread_id: null, author_user_id: m.author_user_id, body: m.body };
  }
  const p = (await query(
    `SELECT p.*, t.channel_id, t.title, (SELECT MIN(id) FROM forum_posts WHERE thread_id = p.thread_id) AS first_id
       FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.id = $1`, [id])).rows[0];
  return p && { channel_id: p.channel_id, thread_id: p.thread_id, author_user_id: p.author_user_id,
                body: p.first_id === p.id ? `${p.title}\n\n${p.body}` : p.body, is_opening: p.first_id === p.id };
}

// POST /reports { target_type: 'message'|'post', target_id, reason, note? }
router.post('/reports', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const type = b.target_type === 'post' ? 'post' : b.target_type === 'message' ? 'message' : null;
    const targetId = parseId(b.target_id);
    if (!type || !targetId) throw new ChatError(400, 'Bad report target.');
    if (!REPORT_REASONS.includes(b.reason)) throw new ChatError(400, 'Pick a reason for the report.');
    const note = b.note ? cleanText(b.note, [0, 300], 'Note') : '';
    const t = await loadTarget(type, targetId);
    if (!t) throw new ChatError(404, 'That has already been removed.');
    await resolveChannel(t.channel_id, req.user, type === 'message' ? 'chat' : 'forum');
    if (!t.author_user_id) throw new ChatError(400, 'System lines cannot be reported.');
    if (t.author_user_id === req.user.userId) throw new ChatError(400, 'You cannot report your own words.');
    const recent = (await query(
      `SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [req.user.userId])).rows[0].n;
    if (recent >= REPORTS_PER_HOUR) throw new ChatError(429, 'You have sent a lot of reports — the team will get to them.');
    const r = await query(
      `INSERT INTO chat_reports (reporter_user_id, target_type, target_id, channel_id, thread_id, reported_user_id,
                                 snapshot_body, reason, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (reporter_user_id, target_type, target_id) WHERE status = 'open' DO NOTHING
       RETURNING id`,
      [req.user.userId, type, targetId, t.channel_id, t.thread_id, t.author_user_id, t.body, b.reason, note]);
    if (r.rows[0]) await notifyStaff();
    res.json({ ok: true, already: !r.rows[0] });
  } catch (e) {
    sendError(res, e, 'Could not send the report.');
  }
});

// GET /reports?status=open|resolved — open reports grouped by target (most
// reported first, then oldest); resolved = the last 50 individual reports.
router.get('/reports', requireAuth, requireStaff, async (req, res) => {
  try {
    const resolved = req.query.status === 'resolved';
    const rows = (await query(
      `SELECT r.*, ru.username AS reporter, tu.username AS reported_user, tu.site_role AS reported_site_role,
              su.username AS resolver, ch.kind AS channel_kind, ch.name AS channel_name, cl.name AS clan_name,
              ft.title AS thread_title,
              (r.target_type = 'post' AND r.target_id = (SELECT MIN(id) FROM forum_posts fp WHERE fp.thread_id = r.thread_id)) AS is_opening,
              CASE WHEN r.target_type = 'message' THEN EXISTS (SELECT 1 FROM chat_messages m WHERE m.id = r.target_id)
                   ELSE EXISTS (SELECT 1 FROM forum_posts p WHERE p.id = r.target_id) END AS still_there,
              (SELECT until FROM user_mutes um WHERE um.user_id = r.reported_user_id
                  AND (um.until IS NULL OR um.until > NOW())) AS muted_until,
              EXISTS (SELECT 1 FROM user_mutes um WHERE um.user_id = r.reported_user_id
                  AND (um.until IS NULL OR um.until > NOW())) AS is_muted
         FROM chat_reports r
         LEFT JOIN users ru ON ru.id = r.reporter_user_id
         LEFT JOIN users tu ON tu.id = r.reported_user_id
         LEFT JOIN users su ON su.id = r.resolved_by
         LEFT JOIN chat_channels ch ON ch.id = r.channel_id
         LEFT JOIN clans cl ON cl.id = ch.clan_id
         LEFT JOIN forum_threads ft ON ft.id = r.thread_id
        WHERE ${resolved ? "r.status <> 'open'" : "r.status = 'open'"}
        ORDER BY ${resolved ? 'r.resolved_at DESC' : 'r.created_at'} LIMIT ${resolved ? 50 : 500}`)).rows;
    const view = r => ({
      target_type: r.target_type, target_id: r.target_id, channel_id: r.channel_id, thread_id: r.thread_id,
      channel: { kind: r.channel_kind, name: r.channel_kind === 'clan' ? r.clan_name : r.channel_name },
      thread_title: r.thread_title, is_opening: !!r.is_opening,
      reported_user: r.reported_user_id ? {
        id: r.reported_user_id, username: r.reported_user,
        staff: mod.staffFor(r.reported_user_id, r.reported_site_role),
        muted: r.is_muted, muted_until: r.muted_until,
      } : null,
      body: r.snapshot_body, still_there: r.still_there,
    });
    if (resolved) {
      return res.json({ ok: true, reports: rows.map(r => ({
        id: r.id, ...view(r), reason: r.reason, note: r.note, reporter: r.reporter, status: r.status,
        resolution: r.resolution, resolver: r.resolver, created_at: r.created_at, resolved_at: r.resolved_at,
      })) });
    }
    const groups = new Map();
    for (const r of rows) {
      const k = `${r.target_type}:${r.target_id}`;
      if (!groups.has(k)) groups.set(k, { id: r.id, ...view(r), first_reported_at: r.created_at, reports: [] });
      groups.get(k).reports.push({ id: r.id, reporter: r.reporter, reason: r.reason, note: r.note, created_at: r.created_at });
    }
    const list = [...groups.values()].sort((a, b) =>
      b.reports.length - a.reports.length || new Date(a.first_reported_at) - new Date(b.first_reported_at));
    res.json({ ok: true, reports: list, open_reports: rows.length });
  } catch (e) {
    sendError(res, e, 'Failed to load reports.');
  }
});

// Removes a reported message/post (the opening post takes its thread).
// Returns true when something was removed.
async function removeTarget(type, id) {
  if (type === 'message') {
    const m = (await query('DELETE FROM chat_messages WHERE id = $1 RETURNING *', [id])).rows[0];
    if (!m) return false;
    const ch = (await query('SELECT * FROM chat_channels WHERE id = $1', [m.channel_id])).rows[0];
    if (ch) publish(ch, 'deleted', { message_id: id });
    return true;
  }
  const t = await loadTarget('post', id);
  if (!t) return false;
  if (t.is_opening) await query('DELETE FROM forum_threads WHERE id = $1', [t.thread_id]);
  else await deletePost(id, t.thread_id);
  const ch = (await query('SELECT * FROM chat_channels WHERE id = $1', [t.channel_id])).rows[0];
  if (ch) forumUpdated(ch, t.thread_id, t.is_opening ? 'thread_deleted' : 'post_deleted');
  return true;
}

// Only admins mute staff; nobody mutes an admin.
function canMute(actorStaff, targetStaff) {
  if (targetStaff === 'admin') return false;
  return !targetStaff || actorStaff === 'admin';
}

// POST /reports/:id/resolve { action: 'dismiss'|'remove'|'remove_and_mute', mute_hours? }
// Resolves every open report on the same target at once.
router.post('/reports/:id/resolve', requireAuth, requireStaff, async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad report.' });
  const action = req.body && req.body.action;
  if (!['dismiss', 'remove', 'remove_and_mute'].includes(action)) return res.status(400).json({ error: 'Bad action.' });
  const hours = req.body.mute_hours == null ? null : Number(req.body.mute_hours);
  if (hours !== null && !(hours >= 0 && hours <= mod.MUTE_MAX_HOURS)) return res.status(400).json({ error: 'Bad mute length.' });
  try {
    const rep = (await query('SELECT * FROM chat_reports WHERE id = $1', [id])).rows[0];
    if (!rep) throw new ChatError(404, 'Report not found.');
    let targetStaff = null;
    if (action === 'remove_and_mute') {
      if (!rep.reported_user_id) throw new ChatError(400, 'That author no longer exists.');
      const u = (await query('SELECT site_role FROM users WHERE id = $1', [rep.reported_user_id])).rows[0];
      targetStaff = mod.staffFor(rep.reported_user_id, u && u.site_role);
      if (!canMute(req.staff, targetStaff)) throw new ChatError(403, 'You cannot mute that member of staff.');
    }
    const status = action === 'dismiss' ? 'dismissed' : 'actioned';
    const resolution = action === 'dismiss' ? 'dismissed'
      : action === 'remove' ? 'removed' : `removed + muted ${hours ? hours + 'h' : 'indefinitely'}`;
    const claimed = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE chat_reports SET status = $3, resolved_by = $4, resolution = $5, resolved_at = NOW()
          WHERE target_type = $1 AND target_id = $2 AND status = 'open' RETURNING id`,
        [rep.target_type, rep.target_id, status, req.user.userId, resolution]);
      if (!r.rowCount) return 0;
      let mute = null;
      if (action === 'remove_and_mute') mute = await mod.mute(client, rep.reported_user_id, req.user.userId, hours, `report: ${rep.reason}`);
      await mod.logModAction(client, req.user.userId, `report_${action}`, rep.reported_user_id, {
        report_ids: r.rows.map(x => x.id), target_type: rep.target_type, target_id: rep.target_id,
        body: rep.snapshot_body, mute_until: mute ? mute.until : undefined,
      });
      return r.rowCount;
    });
    if (!claimed) throw new ChatError(409, 'Another moderator already handled this report.');
    const removed = action === 'dismiss' ? false : await removeTarget(rep.target_type, rep.target_id);
    await notifyStaff({ resolved: { target_type: rep.target_type, target_id: rep.target_id } });
    res.json({ ok: true, resolved: claimed, removed });
  } catch (e) {
    sendError(res, e, 'Could not resolve the report.');
  }
});

async function userByRef(b) {
  const r = b.user_id
    ? await query('SELECT id, username, site_role FROM users WHERE id = $1', [parseId(b.user_id)])
    : await query('SELECT id, username, site_role FROM users WHERE LOWER(username) = LOWER($1)', [String(b.username || '').trim()]);
  if (!r.rows[0]) throw new ChatError(404, 'No player by that name.');
  return r.rows[0];
}

// GET /mutes — active mutes
router.get('/mutes', requireAuth, requireStaff, async (req, res) => {
  try {
    const r = await query(
      `SELECT m.user_id, u.username, m.reason, m.until, m.created_at, b.username AS muted_by
         FROM user_mutes m JOIN users u ON u.id = m.user_id LEFT JOIN users b ON b.id = m.muted_by
        WHERE m.until IS NULL OR m.until > NOW() ORDER BY m.created_at DESC`);
    res.json({ ok: true, mutes: r.rows });
  } catch (e) {
    sendError(res, e, 'Failed to load mutes.');
  }
});

// POST /mutes { username | user_id, hours (0/null = indefinite), reason }
router.post('/mutes', requireAuth, requireStaff, async (req, res) => {
  try {
    const b = req.body || {};
    const u = await userByRef(b);
    if (u.id === req.user.userId) throw new ChatError(400, 'You cannot mute yourself.');
    if (!canMute(req.staff, mod.staffFor(u.id, u.site_role))) throw new ChatError(403, 'You cannot mute that member of staff.');
    const hours = b.hours == null ? null : Number(b.hours);
    if (hours !== null && !(hours >= 0 && hours <= mod.MUTE_MAX_HOURS)) throw new ChatError(400, 'Bad mute length.');
    const reason = b.reason ? cleanText(b.reason, [0, 200], 'Reason') : '';
    const m = await withTransaction(async (client) => {
      const out = await mod.mute(client, u.id, req.user.userId, hours, reason);
      await mod.logModAction(client, req.user.userId, 'mute', u.id, { hours: out.hours, until: out.until, reason });
      return out;
    });
    res.json({ ok: true, user_id: u.id, username: u.username, until: m.until });
  } catch (e) {
    sendError(res, e, 'Could not mute that player.');
  }
});

// DELETE /mutes/:userId — lift a mute
router.delete('/mutes/:userId', requireAuth, requireStaff, async (req, res) => {
  const uid = parseId(req.params.userId);
  if (!uid) return res.status(400).json({ error: 'Bad player.' });
  try {
    const d = await query('DELETE FROM user_mutes WHERE user_id = $1', [uid]);
    if (!d.rowCount) throw new ChatError(404, 'That player is not muted.');
    await mod.logModAction({ query }, req.user.userId, 'unmute', uid, {});
    res.json({ ok: true });
  } catch (e) {
    sendError(res, e, 'Could not lift the mute.');
  }
});

// GET /mod-log — the last 50 moderator actions
router.get('/mod-log', requireAuth, requireStaff, async (req, res) => {
  try {
    const r = await query(
      `SELECT a.id, a.action, a.detail, a.created_at, au.username AS actor, tu.username AS target
         FROM mod_actions a LEFT JOIN users au ON au.id = a.actor_user_id LEFT JOIN users tu ON tu.id = a.target_user_id
        ORDER BY a.id DESC LIMIT 50`);
    res.json({ ok: true, actions: r.rows });
  } catch (e) {
    sendError(res, e, 'Failed to load the log.');
  }
});

// GET /staff — admins (from ADMIN_USER_IDS) and moderators. Admins only.
router.get('/staff', requireAuth, requireAdmin, async (req, res) => {
  try {
    const ids = (process.env.ADMIN_USER_IDS || '').split(',').map(x => parseInt(x.trim(), 10)).filter(Number.isFinite);
    const r = await query(
      `SELECT id, username, site_role FROM users WHERE site_role = 'moderator' OR id = ANY($1::int[]) ORDER BY username`, [ids]);
    res.json({ ok: true, staff: r.rows.map(u => ({ id: u.id, username: u.username, role: mod.staffFor(u.id, u.site_role) })) });
  } catch (e) {
    sendError(res, e, 'Failed to load staff.');
  }
});

// POST /staff { username | user_id, role: 'moderator'|'player' } — admins only
router.post('/staff', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!['moderator', 'player'].includes(b.role)) throw new ChatError(400, 'Bad role.');
    const u = await userByRef(b);
    if (isAdminUser({ userId: u.id })) throw new ChatError(400, 'Admins are set by the server configuration.');
    if (u.site_role === b.role) return res.json({ ok: true, unchanged: true, username: u.username, role: b.role });
    await withTransaction(async (client) => {
      await client.query('UPDATE users SET site_role = $2 WHERE id = $1', [u.id, b.role]);
      await mod.logModAction(client, req.user.userId, b.role === 'moderator' ? 'grant_moderator' : 'revoke_moderator', u.id, {});
    });
    // Their stream reconnects to pick up (or drop) the staff channel.
    const s = (await query('SELECT id FROM settlements WHERE user_id = $1', [u.id])).rows[0];
    if (s) eventBus.publish(s.id, { type: 'site_role_changed', role: b.role });
    res.json({ ok: true, username: u.username, role: b.role });
  } catch (e) {
    sendError(res, e, 'Could not change the role.');
  }
});

router._test = { rateLimited, cleanText, RATE };
module.exports = router;
