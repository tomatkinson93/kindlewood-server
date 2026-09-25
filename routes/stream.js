// ══════════════════════════════════════════════════════════════════════════
//  STREAM — Server-Sent Events for real-time client updates
//
//  GET /api/stream  → text/event-stream response that stays open for the
//                     lifetime of the client's session. Server pushes
//                     "data: <json>\n\n" lines whenever the event bus
//                     publishes something for this client's settlement.
//
//  Why SSE instead of WebSockets:
//    - We only push server→client. Client→server is fine over normal HTTP.
//    - SSE is just chunked HTTP. No special protocol, no extra dependency,
//      passes through every proxy that handles HTTP/1.1+chunked.
//    - Browser EventSource handles reconnection automatically on transient
//      drops (with exponential backoff and a Last-Event-ID header we ignore).
//
//  Anatomy of the response:
//    - Headers: Content-Type text/event-stream, Cache-Control no-cache,
//      Connection keep-alive. X-Accel-Buffering: no in case any proxy
//      tries to buffer chunks.
//    - Initial event with type 'connected' so the client can confirm.
//    - Keepalive comments (`: ping`) every 25s so intermediaries don't
//      treat the connection as idle and close it.
//    - On client disconnect (req 'close'), unsubscribe and clear the
//      keepalive timer.
//
//  Lifecycle gotchas handled:
//    - Response.end() is intentionally NOT called from our side — the
//      connection stays open until the client closes it.
//    - If writes start failing (proxy died, etc), we catch and close.
//    - We support a query-param token fallback (?token=...) because the
//      EventSource API can't set Authorization headers. Cookie auth is
//      the default and preferred — the query-param path is for clients
//      that don't have first-party cookies (some embedded contexts).
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const eventBus = require('../lib/event_bus');
const { staffRole } = require('../lib/moderation');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const KEEPALIVE_MS = 25 * 1000;   // < typical proxy idle timeout of 30s/60s

const router = express.Router();

// Custom auth: accept token from cookie, Authorization header, OR ?token=
// query string. The query-string fallback exists because the EventSource
// constructor cannot set headers. We never log tokens.
function authFromRequest(req) {
  let token = req.cookies && req.cookies.token;
  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  }
  if (!token && req.query && req.query.token) {
    token = String(req.query.token);
  }
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

router.get('/', async (req, res) => {
  const user = authFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Not authenticated.' });
    return;
  }

  // Resolve settlement_id. The bus is keyed on settlement_id so we need this
  // up front.
  let settlementId;
  try {
    const r = await query('SELECT id FROM settlements WHERE user_id=$1', [user.userId]);
    settlementId = r.rows[0] && r.rows[0].id;
  } catch (e) {
    res.status(500).json({ error: 'Could not resolve settlement.' });
    return;
  }
  if (!settlementId) {
    res.status(404).json({ error: 'No settlement for this user.' });
    return;
  }

  // Clan channel (spec 016): clan events publish on `clan:<id>`. The set is
  // fixed for this connection — membership changes publish
  // clan_membership_changed on the settlement channel and the client
  // reconnects. Missing table (pre-migration) or no clan → no clan channel.
  let clanId = null;
  try {
    const c = await query('SELECT clan_id FROM clan_members WHERE user_id=$1', [user.userId]);
    clanId = c.rows[0] ? c.rows[0].clan_id : null;
  } catch (e) { clanId = null; }

  // Site staff (admins + moderators) also get the report queue's "staff"
  // channel. Fixed per connection like the clan channel: a role change
  // publishes site_role_changed and the stream ends so the client
  // reconnects with the right set.
  let staff = null;
  try { staff = await staffRole(user); } catch (e) { staff = null; }

  // ── SSE headers ──
  // X-Accel-Buffering: no is for nginx-fronted hosts (Render's edge does this)
  // so chunks flush immediately instead of being buffered.
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Helper to write one SSE frame. Each "data:" line carries one JSON event.
  // Errors here typically mean the client closed; we treat that as the
  // cleanup signal.
  let closed = false;
  function send(event) {
    if (closed) return;
    try {
      res.write('data: ' + JSON.stringify(event) + '\n\n');
    } catch (e) {
      closed = true;
    }
  }
  function sendKeepalive() {
    if (closed) return;
    try {
      // Comment lines start with ':'. Browsers ignore them but they keep
      // intermediaries from timing the connection out.
      res.write(': ping\n\n');
    } catch (e) {
      closed = true;
    }
  }

  // Initial event so the client can confirm the stream is alive. Also
  // useful as a "did our cookie work?" signal.
  send({ type: 'connected', settlement_id: settlementId, clan_id: clanId, staff, ts: Date.now() });

  // Subscribe to the bus. The returned function lets us clean up cleanly.
  const unsubscribe = eventBus.subscribe(settlementId, (event) => {
    send(event);
    if (closed && unsubscribe) unsubscribe();
    // The clan channel set is fixed per connection, so end the stream on a
    // membership change: the client reconnects with the right channels, and
    // a removed member stops receiving clan events even if their client
    // never reconnects on its own.
    if (event && (event.type === 'clan_membership_changed' || event.type === 'site_role_changed')) setImmediate(cleanup);
  });
  const unsubscribeClan = clanId
    ? eventBus.subscribe(`clan:${clanId}`, (event) => {
        send(event);
        if (closed && unsubscribeClan) unsubscribeClan();
      })
    : () => {};
  // Realm-wide channel (Chat hub community boards + Realm Chat). Every
  // connection subscribes; events are small and notify-then-fetch except
  // chat lines, which carry the message inline.
  const unsubscribeGlobal = eventBus.subscribe('global', (event) => {
    send(event);
    if (closed && unsubscribeGlobal) unsubscribeGlobal();
  });

  const unsubscribeStaff = staff
    ? eventBus.subscribe('staff', (event) => {
        send(event);
        if (closed && unsubscribeStaff) unsubscribeStaff();
      })
    : () => {};

  // Presence for clan rosters: stamp last_seen_at now and when the stream
  // closes. Best-effort.
  const touchSeen = () => query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [user.userId]).catch(() => {});
  touchSeen();

  // Keepalive
  const keepaliveTimer = setInterval(sendKeepalive, KEEPALIVE_MS);

  // Cleanup on client disconnect. Both 'close' (peer hung up) and 'aborted'
  // (request was canceled) are handled by Express; we register on both for
  // safety even though they overlap.
  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(keepaliveTimer);
    unsubscribe();
    unsubscribeClan();
    unsubscribeGlobal();
    unsubscribeStaff();
    touchSeen();
    try { res.end(); } catch (e) {}
  }
  req.on('close', cleanup);
  req.on('aborted', cleanup);
});

// Diagnostic — useful when verifying that publishes actually deliver. Not
// auth'd because the data leaks nothing sensitive (counts only).
router.get('/stats', (req, res) => {
  res.json({ ok: true, ...eventBus.stats() });
});

module.exports = router;
