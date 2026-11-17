const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const D = require('../lib/decor');

// Decorating and charm (docs/HOME_SCENE.md Part F, F.9; lib/decor.js).
//
//   GET    /api/decor                       what is placed, the kinds and costs, the charm
//   POST   /api/decor { kind, area, x, y }  pay and place
//   POST   /api/decor/:id/move { area?, x, y }   free
//   DELETE /api/decor/:id                   half the cost back
//
// Costs, limits and the charm score are here on the server.
const router = express.Router();

async function settlementOf(req) {
  return (await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0] || null;
}
function run(fn) {
  return async (req, res) => {
    try {
      const s = await settlementOf(req);
      if (!s) return res.status(404).json({ error: 'No settlement.' });
      const out = await fn(s, req);
      res.json({ ok: true, ...(out || {}), decor: await D.state(s.id) });
    } catch (e) {
      if (e instanceof D.DecorError) return res.status(e.status).json({ error: e.message });
      console.error('[decor]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

router.get('/', requireAuth, run(async () => null));
router.post('/', requireAuth, run((s, req) => D.place(s.id, req.body || {})));
router.post('/:id/move', requireAuth, run((s, req) => D.move(s.id, req.params.id, req.body || {})));
router.delete('/:id', requireAuth, run((s, req) => D.remove(s.id, req.params.id)));

module.exports = router;
