// ══════════════════════════════════════════════════════════════════════════
//  TAVERN — /api/game/tavern (lib/tavern_pay.js)
//
//  POST /solo-start   { game }          → { ticket }   a solo game begins
//  POST /solo-finish  { ticket, won }   → { won, paid, capped, wealth }
//  Multiplayer games are paid by the server when they finish (game_rooms).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { query } = require('../db');
const pay = require('../lib/tavern_pay');

const router = express.Router();

function send(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[tavern]', e);
  res.status(500).json({ error: fallback });
}

router.post('/solo-start', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ticket: await pay.soloStart(req.user.userId, String((req.body || {}).game || '')) }); }
  catch (e) { send(res, e, 'Could not start the game.'); }
});

router.post('/solo-finish', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const out = await pay.soloFinish(req.user.userId, b.ticket, !!b.won);
    const w = (await query('SELECT wealth FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0];
    res.json({ ok: true, ...out, wealth: w ? Number(w.wealth) : null });
  } catch (e) { send(res, e, 'Could not record the game.'); }
});

module.exports = router;
