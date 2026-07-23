// routes/rooms.js — multiplayer lobby + room API.
//
// REST for client→server (create/join/leave/start/relay/list), SSE for
// server→client (lobby updates, match start, game events). Mirrors the
// existing stream.js pattern: in-memory, single-instance.
//
// Mount in index.js:
//   const roomRoutes = require('./routes/rooms');
//   app.use('/api/rooms', roomRoutes);

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();
const rooms = require('../lib/game_rooms');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Mirrors stream.js: accept the JWT from the `token` cookie, a Bearer
// header, or the ?token= query string. The query fallback exists because
// the API is cross-origin (kindlewood-api.onrender.com vs kindlewood.quest)
// and EventSource cannot send headers or reliably carry third-party cookies.
// Identity field is `userId` to match the auth.js JWT payload.
function user(req) {
  let token = req.cookies && req.cookies.token;
  const authHeader = req.headers.authorization;
  if (!token && authHeader && authHeader.startsWith('Bearer ')) token = authHeader.slice(7);
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token) return null;
  try {
    const p = jwt.verify(token, JWT_SECRET);
    return { id: p.userId, name: p.username || 'Player' };
  } catch {
    return null;
  }
}

function withRoom(req, res) {
  const room = rooms.get(req.params.code);
  if (!room) { res.status(404).json({ error: 'Room not found' }); return null; }
  return room;
}

// ── List public rooms ──
router.get('/list', (req, res) => {
  res.json({ rooms: rooms.listPublic(req.query.game) });
});

// ── Live activity summary (spec 19 §5.4) ──
// Cheap, unauthenticated read used by the tavern select screen to show open
// tables / players waiting / games in progress per game type.
router.get('/summary', (req, res) => {
  res.json({ summary: rooms.summary() });
});

// ── My active games ── used by the tavern screen to offer "rejoin your game".
router.get('/mine', (req, res) => {
  const u = user(req);
  if (!u) return res.json({ rooms: [] });   // not signed in → nothing to resume
  res.json({ rooms: rooms.roomsForUser(u.id) });
});

// ── Create ──
router.post('/create', (req, res) => {
  const u = user(req);
  if (!u) return res.status(401).json({ error: 'Sign in to host a game' });
  try {
    const room = rooms.createRoom({
      gameType: req.body.gameType,
      hostId: u.id, hostName: u.name,
      visibility: req.body.visibility,
      maxPlayers: req.body.maxPlayers,
      difficulty: req.body.difficulty,
    });
    res.json({ room: rooms.publicView(room) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Join by code ──
router.post('/:code/join', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Sign in to join' });
  const room = withRoom(req, res); if (!room) return;
  try { rooms.join(room, u); res.json({ room: rooms.publicView(room) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Forfeit (explicit "Leave game" mid-match) ──
router.post('/:code/forfeit', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  rooms.forfeit(room, u.id);
  res.json({ ok: true });
});

// ── Leave ──
router.post('/:code/leave', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  rooms.leave(room, u.id);
  res.json({ ok: true });
});

// ── Host starts the match ──
router.post('/:code/start', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  try { rooms.start(room, u.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Host adds / removes an AI courtier ──
router.post('/:code/ai/add', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  try { rooms.addAI(room, u.id, req.body && req.body.name); res.json({ room: rooms.publicView(room) }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.post('/:code/ai/remove', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  try { rooms.removeAI(room, u.id, req.body && req.body.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── A player's own game action ──
router.post('/:code/action', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  rooms.gameAction(room, u.id, req.body || {});
  res.json({ ok: true });
});

// AI seats now advance on a server-side clock (lib/game_rooms.js _serverTick),
// so the old host-driven POST /:code/ai-action endpoint has been removed. A
// stale client still pinging it will simply 404 (harmless — the tick drives
// every AI seat regardless).

// ── Host force-ends the match (e.g. a player left and won't return) ──
router.post('/:code/end', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  try { rooms.endMatch(room, u.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Host runs it back: finished match → fresh lobby with the same table ──
router.post('/:code/rematch', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  try { rooms.rematch(room, u.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Chat: public/local/all or a private whisper to one player ──
router.post('/:code/chat', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  const { text, to } = req.body || {};
  const clean = String(text || '').slice(0, 300).trim();
  if (!clean) return res.json({ ok: true });
  rooms.chat(room, u.id, u.name, clean, to);
  res.json({ ok: true });
});

// ── Typing indicator: broadcasts WHO is typing, never the text or target ──
// ── Cursor position relay (multiplayer pointers) ──
router.post('/:code/cursor', (req, res) => {
  const u = user(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = rooms.get(req.params.code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const b = req.body || {};
  rooms.cursor(room, u.id, u.name, +b.x || 0, +b.y || 0);
  res.json({ ok: true });
});

router.post('/:code/typing', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  rooms.typing(room, u.id, !!(req.body && req.body.on));
  res.json({ ok: true });
});

// ── SSE: subscribe to a room ──
router.get('/:code/stream', (req, res) => {
  const u = user(req); if (!u) return res.status(401).end();
  const room = withRoom(req, res); if (!room) return;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const snap = rooms.publicView(room);
  snap.youAreHost = (room.hostId === u.id);
  snap.youId = u.id;
  // On a reconnect to a live match, include the seating so the client can
  // reopen the game table directly (cold resume) instead of the lobby view.
  if (room.status === 'playing' && room.seats) {
    snap.seats = room.seats.map(s => ({ seat: s.seat, id: s.id, name: s.name, isAI: !!s.isAI }));
  }
  res.write(`data: ${JSON.stringify({ type: 'snapshot', room: snap })}\n\n`);

  rooms.subscribe(room, u.id, res);
  // If a match is already underway (e.g. this is a reconnect), send this
  // player their current redacted state right away.
  if (room.status === 'playing' && room.engine && room.state) {
    try { res.write(`data: ${JSON.stringify({ type: 'game_state', state: room.engine.view(room.state, u.id) })}\n\n`); } catch (e) {}
    rooms.markPresent(room, u.id); // back online — cancels grace, restores control if converted
  }
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    rooms.unsubscribe(room, u.id, res);
    const fresh = rooms.get(room.code);
    if (!fresh) return;
    if (fresh.status === 'lobby') {
      // In the lobby, leaving frees the seat immediately.
      if (!fresh.subscribers.has(u.id)) rooms.leave(fresh, u.id);
    } else if (fresh.status === 'playing') {
      // Mid-match: don't remove them. After a short debounce (to ride out a
      // refresh/blip) flag the seat absent; the server tick then converts it
      // to AI once the 60s grace elapses (§3.3).
      if (!fresh.subscribers.has(u.id)) {
        setTimeout(() => {
          const r2 = rooms.get(fresh.code);
          if (r2 && r2.status === 'playing' && !r2.subscribers.has(u.id)) {
            rooms.markAbsent(r2, u.id);
          }
        }, 6000); // debounce a refresh/blip before starting the grace clock
      }
    }
  });
});

module.exports = router;
