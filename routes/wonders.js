// ══════════════════════════════════════════════════════════════════════════
//  WONDERS — /api/wonders (lib/wonders.js)
//
//  GET  /               every wonder: stage, next cost and time, bonus, why not
//  POST /:key/build     pay and start the next stage
//  Dev Tools (admin):
//  POST /admin/finish   { key } finish the stage being built, or the next one free
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { query } = require('../db');
const W = require('../lib/wonders');

const router = express.Router();
const sidOf = async userId => {
  const s = (await query('SELECT id FROM settlements WHERE user_id = $1', [userId])).rows[0];
  if (!s) throw new W.WonderError(404, 'No settlement.');
  return s.id;
};
function send(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[wonders]', e);
  res.status(500).json({ error: fallback });
}

router.get('/', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await W.view(await sidOf(req.user.userId))) }); }
  catch (e) { send(res, e, 'Could not load the wonders.'); }
});
router.post('/admin/finish', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await W.adminFinish(await sidOf(req.user.userId), String((req.body || {}).key || ''))) }); }
  catch (e) { send(res, e, 'Could not finish it.'); }
});
router.post('/:key/build', requireAuth, async (req, res) => {
  try {
    const sid = await sidOf(req.user.userId);
    const v = await W.build(sid, String(req.params.key));
    const s = (await query(`SELECT ${require('../lib/resource_defs').KEYS.join(', ')} FROM settlements WHERE id = $1`, [sid])).rows[0];
    res.json({ ok: true, ...v, resources: s });
  } catch (e) { send(res, e, 'Could not start the stage.'); }
});

module.exports = router;
