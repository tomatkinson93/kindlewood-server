const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const UK = require('../lib/upkeep');

// Upkeep and building health (docs/HOME_SCENE.md Part E; lib/upkeep.js).
//
//   GET  /api/upkeep                        the town card's line, what is wearing, what is damaged
//   POST /api/upkeep/repair { type } | { house_id }   "Repair now": a repair at the front of the builders' queue
//
// Dev Tools (admins, on their own town):
//   POST /api/upkeep/admin/town   { on }      upkeep for this town (everything starts at 100)
//   POST /api/upkeep/admin/switch { on }      upkeep for every town
//   POST /api/upkeep/admin/health { health }  set every building's health here
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
      res.json({ ok: true, ...(out || {}), upkeep: await UK.status(s.id) });
    } catch (e) {
      if (e instanceof UK.UpkeepError || (e && e.status === 400)) return res.status(e.status).json({ error: e.message });
      console.error('[upkeep]', e);
      res.status(500).json({ error: 'That did not work. Try again.' });
    }
  };
}

router.get('/', requireAuth, run(async () => null));
router.post('/repair', requireAuth, run(async (s, req) => {
  const b = req.body || {};
  return { repair: await UK.repairNow(s.id, b.house_id != null ? { kind: 'house', id: b.house_id } : { kind: 'building', type: b.type }) };
}));
router.post('/admin/town', requireAuth, requireAdmin, run(async (s, req) => ({ on: await UK.setTown(s.id, !!(req.body || {}).on) })));
router.post('/admin/switch', requireAuth, requireAdmin, run(async (s, req) => ({ everywhere: await UK.setAll(!!(req.body || {}).on) })));
router.post('/admin/health', requireAuth, requireAdmin, run(async (s, req) => ({ health: await UK.setHealth(s.id, (req.body || {}).health) })));

module.exports = router;
