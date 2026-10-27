// ══════════════════════════════════════════════════════════════════════════
//  RESEARCH — /api/research (lib/research, lib/research_defs)
//
//  GET   /                     the Library: projects, scholars, points/hr, ETA
//  POST  /start                { project }  study it now (keeps its progress)
//  POST  /queue                { project }  add to the queue (with missing prerequisites)
//  DELETE /queue/:project                   remove from the queue (and what needed it)
//  Dev Tools (admin):
//  POST  /admin/complete       { project }  finish it for your town now
//  POST  /admin/reset          forget all your town's research
//  GET   /admin/defs           every project's key and name (the browser
//                              never gets the whole tree otherwise)
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

router.post('/queue', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await research.queueAdd(await mySettlementId(req.user.userId), String((req.body || {}).project || ''))) }); }
  catch (e) { send(res, e, 'Could not queue that project.'); }
});

router.delete('/queue/:project', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await research.queueRemove(await mySettlementId(req.user.userId), String(req.params.project || ''))) }); }
  catch (e) { send(res, e, 'Could not change the queue.'); }
});

router.post('/admin/complete', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await research.adminComplete(await mySettlementId(req.user.userId), String((req.body || {}).project || ''))) }); }
  catch (e) { send(res, e, 'Could not finish it.'); }
});

router.get('/admin/defs', requireAuth, requireAdmin, (req, res) => {
  const RS = require('../lib/research_defs');
  res.json({ ok: true, projects: RS.KEYS.map(k => ({ key: k, label: RS.PROJECTS[k].label, branch: RS.PROJECTS[k].branch, tier: RS.PROJECTS[k].tier })) });
});

router.post('/admin/reset', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await research.adminReset(await mySettlementId(req.user.userId))) }); }
  catch (e) { send(res, e, 'Could not reset research.'); }
});

module.exports = router;
