// ══════════════════════════════════════════════════════════════════════════
//  RESEARCH — /api/research (lib/research, lib/research_defs)
//
//  GET   /                     the Library: projects, scholars, points/hr, ETA
//  POST  /start                { project }  study this next (keeps its progress)
//  Dev Tools (admin):
//  POST  /admin/complete       { project }  finish it for your town now
//  POST  /admin/reset          forget all your town's research
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const research = require('../lib/research');

const router = express.Router();

async function mySettlementId(userId) {
  const r = await query('SELECT id FROM settlements WHERE user_id = $1', [userId]);
  if (!r.rows[0]) throw new research.ResearchError(404, 'No settlement.');
  return r.rows[0].id;
}
function send(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[research]', e);
  res.status(500).json({ error: fallback });
}

router.get('/', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await research.view(await mySettlementId(req.user.userId))) }); }
  catch (e) { send(res, e, 'Could not load the Library.'); }
});

router.post('/start', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await research.start(await mySettlementId(req.user.userId), String((req.body || {}).project || ''))) }); }
  catch (e) { send(res, e, 'Could not start that project.'); }
});

router.post('/admin/complete', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await research.adminComplete(await mySettlementId(req.user.userId), String((req.body || {}).project || ''))) }); }
  catch (e) { send(res, e, 'Could not finish it.'); }
});

router.post('/admin/reset', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await research.adminReset(await mySettlementId(req.user.userId))) }); }
  catch (e) { send(res, e, 'Could not reset research.'); }
});

module.exports = router;
