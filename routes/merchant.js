const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { gameplayNow } = require('../lib/server_clock');
const { requireAdmin } = require('../middleware/admin');
const M = require('../lib/merchant');

// A visiting merchant (docs/HOME_SCENE.md Part F, F.13; lib/merchant.js).
//
//   GET  /api/merchant               is the merchant here, the trades, when they next come
//   POST /api/merchant/take { idx }  make one trade (once each)
//   POST /api/merchant/admin/call { on }   Dev Tools: the merchant comes today
//
// When they come, what they offer and what has been taken are all here.
const router = express.Router();

async function settlementOf(req) {
  return (await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0] || null;
}
function run(fn) {
  return async (req, res) => {
    try {
      const s = await settlementOf(req);
      if (!s) return res.status(404).json({ error: 'No settlement.' });
      const now = gameplayNow(req.user);
      const out = await fn(s, req, now);
      res.json({ ok: true, ...(out || {}), merchant: await M.state(s.id, now) });
    } catch (e) {
      if (e instanceof M.MerchantError) return res.status(e.status).json({ error: e.message });
      // Two devices at the same moment: the table's own once-each rule answers.
      if (e && e.code === '23505') return res.status(409).json({ error: 'You have already made that trade.' });
      console.error('[merchant]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

router.get('/', requireAuth, run(async () => null));
router.post('/take', requireAuth, run((s, req, now) => M.take(s.id, (req.body || {}).idx, now)));

// Dev Tools (admins, on their own town): the merchant comes today.
router.post('/admin/call', requireAuth, requireAdmin, run(async (s, req, now) => M.call(s.id, (req.body || {}).on !== false, now)));

module.exports = router;
