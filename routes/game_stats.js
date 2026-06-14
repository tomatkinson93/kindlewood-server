// routes/game_stats.js — win/play tracking for tavern games + leaderboards.
//
// Self-contained: ensures its own table on first load so db.js needs no
// edits. Records a result per finished game and serves aggregate boards.
//
// Mount in index.js:
//   const gameStatsRoutes = require('./routes/game_stats');
//   app.use('/api/stats', gameStatsRoutes);

const express = require('express');
const jwt = require('jsonwebtoken');
const { query } = require('../db');
const store = require('../lib/game_stats_store');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// ── Auth (cookie / Bearer / ?token=), same pattern as the other routes ──
function user(req) {
  let token = req.cookies && req.cookies.token;
  const h = req.headers.authorization;
  if (!token && h && h.startsWith('Bearer ')) token = h.slice(7);
  if (!token && req.query && req.query.token) token = String(req.query.token);
  if (!token) return null;
  try { const p = jwt.verify(token, JWT_SECRET); return { id: p.userId, name: p.username || 'Player' }; }
  catch { return null; }
}

// ── Record a finished game: { game, won, mode } ──
// We only count human players (a logged-in user). Solo + multiplayer both
// recorded; the leaderboard can filter later if desired.
router.post('/record', async (req, res) => {
  const u = user(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  const game = String((req.body && req.body.game) || '').slice(0, 40) || 'briar';
  const won = !!(req.body && req.body.won);
  try {
    await store.record(u.id, game, won);
    res.json({ ok: true });
  } catch (e) {
    console.error('stats record error:', e);
    res.status(500).json({ error: 'Could not record result' });
  }
});

// ── This user's own stats ──
router.get('/me', async (req, res) => {
  const u = user(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  try {
    await store.ready();
    const r = await query('SELECT game, wins, games FROM game_stats WHERE user_id=$1', [u.id]);
    res.json({ ok: true, stats: r.rows });
  } catch (e) { res.status(500).json({ error: 'Could not load stats' }); }
});

// ── Leaderboard for a game (default briar), top 25 by wins ──
router.get('/leaderboard', async (req, res) => {
  const game = String(req.query.game || 'briar').slice(0, 40);
  try {
    await store.ready();
    const r = await query(`
      SELECT u.username, s.wins, s.games
      FROM game_stats s JOIN users u ON u.id = s.user_id
      WHERE s.game = $1 AND s.games > 0
      ORDER BY s.wins DESC, s.games ASC
      LIMIT 25
    `, [game]);
    res.json({ ok: true, leaderboard: r.rows });
  } catch (e) { res.status(500).json({ error: 'Could not load leaderboard' }); }
});

module.exports = router;
