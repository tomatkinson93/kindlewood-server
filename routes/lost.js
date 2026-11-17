const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { gameplayNow } = require('../lib/server_clock');
const L = require('../lib/lost');

// A lost thing each day (docs/HOME_SCENE.md Part F, F.8; lib/lost.js).
//
//   GET  /api/lost          today's thing: what, whose, where (a seed), found or not
//   POST /api/lost/return   the player found it: the owner is happier, the town is thanked
//
// One per town per day, counted here, so a second device gains nothing.
const router = express.Router();

async function settlementOf(req) {
  return (await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0] || null;
}
function run(fn) {
  return async (req, res) => {
    try {
      const s = await settlementOf(req);
      if (!s) return res.status(404).json({ error: 'No settlement.' });
      res.json({ ok: true, thing: await fn(s, gameplayNow(req.user)) });
    } catch (e) {
      if (e instanceof L.LostError) return res.status(e.status).json({ error: e.message });
      console.error('[lost]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

router.get('/', requireAuth, run((s, now) => L.today(s.id, now)));
router.post('/return', requireAuth, run((s, now) => L.giveBack(s.id, now)));

module.exports = router;
