// routes/presence.js — who's currently online.
//
// Lightweight heartbeat presence: clients POST /api/presence/ping every
// ~30s; we keep an in-memory map of userId -> { name, lastSeen }. Anyone
// seen within the window counts as online. In-memory + single-instance,
// same constraint as the event bus.
//
// Mount in index.js:
//   const presenceRoutes = require('./routes/presence');
//   app.use('/api/presence', presenceRoutes);

const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const ONLINE_WINDOW_MS = 70 * 1000;   // seen within 70s ⇒ online (2 missed pings)

const online = new Map(); // userId -> { name, lastSeen }

function user(req) {
  let token = req.cookies && req.cookies.token;
  const h = req.headers.authorization;
  if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token) return null;
  try { const p = jwt.verify(token, JWT_SECRET); return { id: p.userId, name: p.username || 'Player' }; }
  catch { return null; }
}

// Heartbeat — also marks "I'm here"
router.post('/ping', (req, res) => {
  const u = user(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  online.set(u.id, { name: u.name, lastSeen: Date.now() });
  res.json({ ok: true });
});

// Explicit logout / leaving
router.post('/leave', (req, res) => {
  const u = user(req);
  if (u) online.delete(u.id);
  res.json({ ok: true });
});

// Who's online right now
router.get('/list', (req, res) => {
  const now = Date.now();
  const list = [];
  for (const [id, v] of online) {
    if (now - v.lastSeen <= ONLINE_WINDOW_MS) list.push({ id, name: v.name });
    else online.delete(id); // prune stale
  }
  list.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ ok: true, count: list.length, online: list });
});

// Periodic prune so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [id, v] of online) if (now - v.lastSeen > ONLINE_WINDOW_MS) online.delete(id);
}, 60000).unref();

module.exports = router;
