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
const router = express.Router();
const rooms = require('../lib/game_rooms');

// requireAuth populates req.user ({ id, name }) elsewhere in the app.
// Falls back gracefully if the middleware isn't wired on this router.
function user(req) {
  if (req.user) return { id: req.user.id, name: req.user.name || req.user.username || 'Player' };
  return null;
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

// ── Relay an in-game action (Phase-2 seam) ──
router.post('/:code/action', (req, res) => {
  const u = user(req); if (!u) return res.status(401).json({ error: 'Not signed in' });
  const room = withRoom(req, res); if (!room) return;
  rooms.relay(room, u.id, req.body);
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
  res.write(`data: ${JSON.stringify({ type: 'snapshot', room: rooms.publicView(room) })}\n\n`);

  rooms.subscribe(room, u.id, res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    rooms.unsubscribe(room, u.id, res);
    // If they have no other open tab and we're still in the lobby, drop them
    const fresh = rooms.get(room.code);
    if (fresh && fresh.status === 'lobby' && !fresh.subscribers.has(u.id)) {
      rooms.leave(fresh, u.id);
    }
  });
});

module.exports = router;
