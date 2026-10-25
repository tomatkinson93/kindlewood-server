// ══════════════════════════════════════════════════════════════════════════
//  CAREERS — /api/careers (lib/careers)
//
//  GET  /defs                       classes, trees, effects, traits, curve
//  GET  /citizen/:id                one citizen's career (settles first)
//  POST /citizen/:id/nodes          { class_key, node_id }  buy one perk rank
//  POST /citizen/:id/fork           { class_key, spec }     choose the path (Lv10, for life)
//  POST /citizen/:id/retrain        { class_key }           refund perks for gold; 2h off work
//  Dev Tools (admin):
//  POST /admin/citizen/:id/grant    { class_key, xp?, level?, hours? }
//  POST /admin/citizen/:id/reveal   { trait }
//  POST /admin/citizen/:id/reset    { class_key? }          wipe a class (or the whole career)
//  GET  /admin/balance              server-wide overview (lib/career_balance) + tuning
//  POST /admin/tuning               { key, value }          a balance multiplier (lib/tuning)
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const careers = require('../lib/careers');

const router = express.Router();

async function mySettlementId(userId) {
  const r = await query('SELECT id FROM settlements WHERE user_id = $1', [userId]);
  if (!r.rows[0]) throw new careers.CareerError(404, 'No settlement.');
  return r.rows[0].id;
}
const citizenId = req => {
  const n = parseInt(req.params.id, 10);
  if (!Number.isInteger(n) || n <= 0) throw new careers.CareerError(400, 'Bad citizen id.');
  return n;
};
function send(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[careers]', e);
  res.status(500).json({ error: fallback });
}

router.get('/defs', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ ok: true, ...careers.defs() });
});

router.get('/citizen/:id', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    res.json({ ok: true, career: await careers.citizenCareer(sid, citizenId(req)) });
  } catch (e) { send(res, e, 'Could not load the career.'); }
});

router.post('/citizen/:id/nodes', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const out = await careers.buyNode(sid, citizenId(req), String(req.body.class_key || ''), String(req.body.node_id || ''));
    res.json({ ok: true, ...out });
  } catch (e) { send(res, e, 'Could not learn that perk.'); }
});

router.post('/citizen/:id/fork', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const out = await careers.chooseFork(sid, citizenId(req), String(req.body.class_key || ''), String(req.body.spec || ''));
    res.json({ ok: true, ...out });
  } catch (e) { send(res, e, 'Could not choose that path.'); }
});

router.post('/citizen/:id/retrain', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const out = await careers.retrain(sid, citizenId(req), String(req.body.class_key || ''));
    res.json({ ok: true, ...out });
  } catch (e) { send(res, e, 'Could not retrain.'); }
});

// ── Dev Tools ──────────────────────────────────────────────────────────────

router.post('/admin/citizen/:id/grant', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const b = req.body || {};
    await careers.adminGrant(sid, citizenId(req), String(b.class_key || ''), {
      xp: Number(b.xp) || 0, level: b.level ? Number(b.level) : null, hours: Number(b.hours) || 0,
    });
    res.json({ ok: true, career: await careers.citizenCareer(sid, citizenId(req)) });
  } catch (e) { send(res, e, 'Could not grant.'); }
});

router.post('/admin/citizen/:id/reveal', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    await careers.adminReveal(sid, citizenId(req), String((req.body || {}).trait || ''));
    res.json({ ok: true, career: await careers.citizenCareer(sid, citizenId(req)) });
  } catch (e) { send(res, e, 'Could not reveal.'); }
});

router.get('/admin/balance', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/career_balance').overview()) }); }
  catch (e) { console.error('[careers] balance', e); res.status(500).json({ error: 'Could not build the overview.' }); }
});

router.post('/admin/tuning', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, tuning: await require('../lib/tuning').set(String((req.body || {}).key || ''), (req.body || {}).value) }); }
  catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Could not save.' }); }
});

router.post('/admin/citizen/:id/reset', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    await careers.adminReset(sid, citizenId(req), (req.body || {}).class_key || null);
    res.json({ ok: true, career: await careers.citizenCareer(sid, citizenId(req)) });
  } catch (e) { send(res, e, 'Could not reset.'); }
});

module.exports = router;
