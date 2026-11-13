// ══════════════════════════════════════════════════════════════════════════
//  Moments API (docs/PHASE_2_MOMENTS.md §2.5).
//
//    GET  /api/moments                 open moments, soonest to expire first
//    POST /api/moments/:id { choice }  answer one: the outcome and what changed
//    GET  /api/moments/recent          the last 20 resolved
//    Admins (Dev Tools):
//    GET  /api/moments/admin/kinds     every kind, with its source and content problems
//    POST /api/moments/admin/start { kind, outpost_id? }   one now, if it fits
//    POST /api/moments/admin/roll      run the daily budget for this town now
//    POST /api/moments/admin/expire    take the default on every open one now
//    GET  /api/moments/admin/stats     shown / answered / timed out / choices per kind
// ══════════════════════════════════════════════════════════════════════════
const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const M = require('../lib/moments');

const router = express.Router();

async function town(req, res) {
  const s = (await query('SELECT id FROM settlements WHERE user_id = $1', [req.user.userId])).rows[0];
  if (!s) res.status(404).json({ error: 'No settlement.' });
  return s || null;
}

router.get('/', requireAuth, async (req, res) => {
  try { const s = await town(req, res); if (!s) return; res.json({ ok: true, moments: await M.open(s.id), cap: M.CONFIG.CAP }); }
  catch (e) { console.error('[moments] list', e); res.status(500).json({ error: 'Failed to load moments.' }); }
});

router.get('/recent', requireAuth, async (req, res) => {
  try { const s = await town(req, res); if (!s) return; res.json({ ok: true, moments: await M.recent(s.id) }); }
  catch (e) { console.error('[moments] recent', e); res.status(500).json({ error: 'Failed to load moments.' }); }
});

// ── Admin ───────────────────────────────────────────────────────────────────
router.get('/admin/kinds', requireAuth, requireAdmin, (req, res) => {
  res.json({ ok: true, kinds: Object.values(M.DEFS).map(d => ({ kind: d.kind, source: d.source, icon: d.icon, title: d.title, weight: d.weight,
    cooldown_days: d.cooldownDays, expire_hours: d.expireHours, gentle: !!d.gentle, trigger_only: !!d.triggerOnly })) });
});
router.post('/admin/start', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const { kind, outpost_id } = req.body || {};
    if (!M.DEFS[kind]) return res.status(400).json({ error: 'Unknown kind.' });
    const m = await M.start(s.id, kind, { args: outpost_id ? { outpost_id: Number(outpost_id) } : {} });
    if (!m) return res.status(400).json({ error: `“${M.DEFS[kind].title}” can't happen in your town right now (nothing fits it).` });
    res.json({ ok: true, moment: m });
  } catch (e) { console.error('[moments] admin start', e); res.status(500).json({ error: 'Failed to start it.' }); }
});
router.post('/admin/roll', requireAuth, requireAdmin, async (req, res) => {
  try { const s = await town(req, res); if (!s) return; const m = await M.roll(s.id); res.json({ ok: true, moment: m || null }); }
  catch (e) { console.error('[moments] admin roll', e); res.status(500).json({ error: 'Failed to roll.' }); }
});
router.post('/admin/expire', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const open = (await query('SELECT id, kind FROM moments WHERE settlement_id = $1 AND resolved_at IS NULL', [s.id])).rows;
    const out = [];
    for (const r of open) out.push(await M.choose(s.id, r.id, M.DEFS[r.kind] ? M.DEFS[r.kind].fallback : null, true));
    res.json({ ok: true, resolved: out.filter(x => x && x.ok).length });
  } catch (e) { console.error('[moments] admin expire', e); res.status(500).json({ error: 'Failed to expire them.' }); }
});
router.get('/admin/stats', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, kinds: await M.stats(Number(req.query.days) || 30) }); }
  catch (e) { console.error('[moments] admin stats', e); res.status(500).json({ error: 'Failed to load the stats.' }); }
});

// Last, so /recent and /admin/* aren't taken for an id.
router.post('/:id', requireAuth, async (req, res) => {
  try {
    const s = await town(req, res); if (!s) return;
    const id = parseInt(req.params.id, 10);
    const choice = String((req.body || {}).choice || '');
    if (!Number.isInteger(id) || !choice) return res.status(400).json({ error: 'Choose one of the options.' });
    const r = await M.choose(s.id, id, choice);
    if (!r || r.error) return res.status((r && r.status) || 400).json({ error: (r && r.error) || 'That could not be done.' });
    res.json(r);
  } catch (e) { console.error('[moments] choose', e); res.status(500).json({ error: 'Failed to answer.' }); }
});

module.exports = router;
