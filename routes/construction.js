const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const CN = require('../lib/construction');

// Building time (docs/HOME_SCENE.md Part D; lib/construction.js): the queue of
// construction sites. Sites are ordered by the Buildings and Neighbourhood
// routes (paying starts a site); these read and tend the queue.
//
//   GET  /api/construction                     the queue, how far along, who builds
//   POST /api/construction/reorder { ids }     the open sites in a new order
//   POST /api/construction/sites/:id/cancel    all back before any work, half after
//
// Dev Tools (admins, on their own town):
//   POST /api/construction/admin/town     { on }       building time for this town
//   POST /api/construction/admin/switch   { on }       building time for every town
//   POST /api/construction/admin/finish   { site_id? } finish a site now (the first, if none named)
//   POST /api/construction/admin/builders { count }    make that many grown-ups builders
const router = express.Router();

async function settlementOf(req) {
  return (await query('SELECT id, construction_on FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0] || null;
}
function run(fn) {
  return async (req, res) => {
    try {
      const s = await settlementOf(req);
      if (!s) return res.status(404).json({ error: 'No settlement.' });
      const out = await fn(s, req);
      res.json({ ok: true, ...(out || {}), queue: await CN.queue(s.id) });
    } catch (e) {
      if (e instanceof CN.SiteError || (e && e.status === 400)) return res.status(e.status).json({ error: e.message });
      console.error('[construction]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

router.get('/', requireAuth, run(async () => null));
router.post('/reorder', requireAuth, run(async (s, req) => { await CN.reorder(s.id, (req.body || {}).ids); }));
router.post('/sites/:id/cancel', requireAuth, run(async (s, req) => ({ cancelled: await CN.cancel(s.id, req.params.id) })));

router.post('/admin/town', requireAuth, requireAdmin, run(async (s, req) => ({ on: await CN.setTown(s.id, !!(req.body || {}).on) })));
router.post('/admin/switch', requireAuth, requireAdmin, run(async (s, req) => ({ everywhere: await require('../lib/tuning').setSwitch('construction.on', !!(req.body || {}).on) })));
router.post('/admin/finish', requireAuth, requireAdmin, run(async (s, req) => ({ finished: await CN.finishNow(s.id, (req.body || {}).site_id == null ? null : (req.body || {}).site_id) })));
router.post('/admin/builders', requireAuth, requireAdmin, run(async (s, req) => ({ builders: await CN.setBuilders(s.id, (req.body || {}).count) })));

module.exports = router;
