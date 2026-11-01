// ══════════════════════════════════════════════════════════════════════════
//  MAIL — /api/mail: letters between players.
//
//  GET    /?box=inbox|sent        your letters (newest first, 100)
//  GET    /unread                 { unread }
//  POST   /  { to, subject, body }   to = username (or user_id)
//  POST   /:id/read
//  DELETE /:id                    remove your copy (the other side keeps theirs)
//  POST   /:id/report { reason, note? }   recipient only → moderators' queue
//  GET    /blocks · POST /block { user_id | username } · DELETE /block/:userId
//
//  Muted players can't send; a blocked sender is refused; 20 letters an
//  hour. Reports go into chat_reports (target_type 'mail'), so moderators
//  see them with chat and forum reports and can remove + mute
//  (routes/chat.js removeTarget sets removed_at).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { query } = require('../db');
const mod = require('../lib/moderation');
const eventBus = require('../lib/event_bus');

const router = express.Router();
const SUBJECT_MAX = 80, BODY_MAX = 2000, SENDS_PER_HOUR = 20, BOX_LIMIT = 100;

class MailError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
function send(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[mail]', e);
  res.status(500).json({ error: fallback });
}
const parseId = v => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const chat = () => require('./chat');   // report helpers (lazy: avoids a load-order loop)

function view(m, me) {
  const removed = !!m.removed_at;
  return {
    id: m.id, subject: removed ? '' : m.subject, body: removed ? '' : m.body, removed,
    created_at: m.created_at, read: !!m.read_at,
    from: m.sender_user_id ? { id: m.sender_user_id, username: m.sender_name } : null,
    to: { id: m.recipient_user_id, username: m.recipient_name },
    mine: m.sender_user_id === me,
  };
}

async function userByRef(ref) {
  const r = parseId(ref && ref.user_id)
    ? await query('SELECT id, username FROM users WHERE id = $1', [parseId(ref.user_id)])
    : await query('SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)', [String((ref && (ref.to || ref.username)) || '').trim()]);
  if (!r.rows[0]) throw new MailError(404, 'No player by that name.');
  return r.rows[0];
}

const SELECT = `SELECT m.*, su.username AS sender_name, ru.username AS recipient_name
                  FROM mail_messages m
                  LEFT JOIN users su ON su.id = m.sender_user_id
                  LEFT JOIN users ru ON ru.id = m.recipient_user_id`;

router.get('/', requireAuth, async (req, res) => {
  try {
    const me = req.user.userId, sent = req.query.box === 'sent';
    const rows = (await query(`${SELECT}
       WHERE ${sent ? 'm.sender_user_id = $1 AND NOT m.sender_deleted' : 'm.recipient_user_id = $1 AND NOT m.recipient_deleted'}
       ORDER BY m.created_at DESC LIMIT ${BOX_LIMIT}`, [me])).rows;
    const unread = (await query('SELECT COUNT(*)::int AS n FROM mail_messages WHERE recipient_user_id = $1 AND read_at IS NULL AND NOT recipient_deleted', [me])).rows[0].n;
    res.json({ ok: true, box: sent ? 'sent' : 'inbox', letters: rows.map(m => view(m, me)), unread });
  } catch (e) { send(res, e, 'Could not load your letters.'); }
});

router.get('/unread', requireAuth, async (req, res) => {
  try {
    const n = (await query('SELECT COUNT(*)::int AS n FROM mail_messages WHERE recipient_user_id = $1 AND read_at IS NULL AND NOT recipient_deleted', [req.user.userId])).rows[0].n;
    res.json({ ok: true, unread: n });
  } catch (e) { send(res, e, 'Could not check your letters.'); }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const me = req.user.userId, b = req.body || {};
    const muted = await mod.activeMute(me);
    if (muted) throw new MailError(403, mod.muteMessage(muted).replace('in the realm channels', 'and can\'t send letters'));
    const to = await userByRef(b);
    if (to.id === me) throw new MailError(400, 'You can\'t send a letter to yourself.');
    const subject = String(b.subject || '').trim().slice(0, SUBJECT_MAX);
    const body = String(b.body || '').trim();
    if (!body) throw new MailError(400, 'Write something first.');
    if (body.length > BODY_MAX) throw new MailError(400, `Letters can be up to ${BODY_MAX} characters.`);
    const blocked = (await query('SELECT 1 FROM mail_blocks WHERE user_id = $1 AND blocked_user_id = $2', [to.id, me])).rows[0];
    if (blocked) throw new MailError(403, 'They aren\'t accepting your letters.');
    const recent = (await query("SELECT COUNT(*)::int AS n FROM mail_messages WHERE sender_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'", [me])).rows[0].n;
    if (recent >= SENDS_PER_HOUR) throw new MailError(429, 'You\'ve sent a lot of letters this hour — try again later.');
    const m = (await query(
      'INSERT INTO mail_messages (sender_user_id, recipient_user_id, subject, body) VALUES ($1,$2,$3,$4) RETURNING *',
      [me, to.id, subject, body])).rows[0];
    // The recipient's badge (js/mail.js via realtime).
    const sid = (await query('SELECT id FROM settlements WHERE user_id = $1', [to.id])).rows[0];
    const from = (await query('SELECT username FROM users WHERE id = $1', [me])).rows[0];
    if (sid) eventBus.publish(sid.id, { type: 'mail', from: from ? from.username : null, subject });
    res.json({ ok: true, letter: view({ ...m, sender_name: from && from.username, recipient_name: to.username }, me) });
  } catch (e) { send(res, e, 'Could not send the letter.'); }
});

router.post('/:id/read', requireAuth, async (req, res) => {
  try {
    const r = await query('UPDATE mail_messages SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND recipient_user_id = $2 RETURNING id', [parseId(req.params.id), req.user.userId]);
    if (!r.rowCount) throw new MailError(404, 'Letter not found.');
    res.json({ ok: true });
  } catch (e) { send(res, e, 'Could not mark it read.'); }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const id = parseId(req.params.id), me = req.user.userId;
    const r = await query(
      `UPDATE mail_messages SET recipient_deleted = recipient_deleted OR recipient_user_id = $2,
                                sender_deleted = sender_deleted OR sender_user_id = $2,
                                read_at = CASE WHEN recipient_user_id = $2 THEN COALESCE(read_at, NOW()) ELSE read_at END
        WHERE id = $1 AND (recipient_user_id = $2 OR sender_user_id = $2) RETURNING id`, [id, me]);
    if (!r.rowCount) throw new MailError(404, 'Letter not found.');
    res.json({ ok: true });
  } catch (e) { send(res, e, 'Could not delete it.'); }
});

router.post('/:id/report', requireAuth, async (req, res) => {
  try {
    const me = req.user.userId, b = req.body || {}, c = chat();
    const m = (await query('SELECT * FROM mail_messages WHERE id = $1 AND recipient_user_id = $2', [parseId(req.params.id), me])).rows[0];
    if (!m) throw new MailError(404, 'Letter not found.');
    if (m.removed_at) throw new MailError(404, 'That has already been removed.');
    if (!m.sender_user_id) throw new MailError(400, 'The sender no longer exists.');
    if (!c.REPORT_REASONS.includes(b.reason)) throw new MailError(400, 'Pick a reason for the report.');
    const note = String(b.note || '').trim().slice(0, 300);
    const recent = (await query("SELECT COUNT(*)::int AS n FROM chat_reports WHERE reporter_user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'", [me])).rows[0].n;
    if (recent >= c.REPORTS_PER_HOUR) throw new MailError(429, 'You have sent a lot of reports — the team will get to them.');
    const snapshot = (m.subject ? m.subject + '\n\n' : '') + m.body;
    const r = await query(
      `INSERT INTO chat_reports (reporter_user_id, target_type, target_id, reported_user_id, snapshot_body, reason, note)
       VALUES ($1,'mail',$2,$3,$4,$5,$6)
       ON CONFLICT (reporter_user_id, target_type, target_id) WHERE status = 'open' DO NOTHING RETURNING id`,
      [me, m.id, m.sender_user_id, snapshot, b.reason, note]);
    if (r.rows[0]) await c.notifyStaff();
    res.json({ ok: true, already: !r.rows[0] });
  } catch (e) { send(res, e, 'Could not send the report.'); }
});

router.get('/blocks', requireAuth, async (req, res) => {
  try {
    const rows = (await query(`SELECT b.blocked_user_id AS id, u.username FROM mail_blocks b JOIN users u ON u.id = b.blocked_user_id
                                WHERE b.user_id = $1 ORDER BY u.username`, [req.user.userId])).rows;
    res.json({ ok: true, blocked: rows });
  } catch (e) { send(res, e, 'Could not load your blocks.'); }
});

router.post('/block', requireAuth, async (req, res) => {
  try {
    const u = await userByRef(req.body || {});
    if (u.id === req.user.userId) throw new MailError(400, 'You can\'t block yourself.');
    await query('INSERT INTO mail_blocks (user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.user.userId, u.id]);
    res.json({ ok: true, blocked: { id: u.id, username: u.username } });
  } catch (e) { send(res, e, 'Could not block them.'); }
});

router.delete('/block/:userId', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM mail_blocks WHERE user_id = $1 AND blocked_user_id = $2', [req.user.userId, parseId(req.params.userId)]);
    res.json({ ok: true });
  } catch (e) { send(res, e, 'Could not unblock them.'); }
});

module.exports = router;
