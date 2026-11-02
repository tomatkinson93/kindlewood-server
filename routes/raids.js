// ══════════════════════════════════════════════════════════════════════════
//  /api/raids — soft raids by the Withered (lib/raids).
//
//  GET  /               the raid on its way (if any), recent raids, your
//                       defence, and whether the Withered can reach you
//  GET  /calls          raids on clanmates' clan-land spots you can help hold
//  POST /:id/reinforce  { citizen_id } send a Guard/Archer to hold one
//  POST /tribute        24 hours of peace (escalating; turns back a raid on its way at double)
//  POST /admin/send     Dev Tools: raiders gather now ({ minutes } to arrival, default 6h)
//  POST /admin/peace-clear  Dev Tools: forget tribute peace
//  POST /admin/resolve  Dev Tools: the raid on its way strikes now
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { query } = require('../db');
const R = require('../lib/raids');

const router = express.Router();
const mine = async uid => (await query('SELECT * FROM settlements WHERE user_id=$1', [uid])).rows[0] || null;

router.get('/', requireAuth, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const active = await R.activeFor(s.id);
    const recent = (await query('SELECT * FROM settlement_raids WHERE settlement_id=$1 AND resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 5', [s.id])).rows.map(R.view);
    const target = await R.targetFor(s, await R.withered((t, p) => query(t, p)), (t, p) => query(t, p));
    const o = active && active.outpost_id ? (await query('SELECT tile_q, tile_r FROM outposts WHERE id=$1', [active.outpost_id])).rows[0] : null;
    const at = o ? { q: o.tile_q, r: o.tile_r } : target ? { q: target.q, r: target.r } : { q: s.tile_q, r: s.tile_r };
    const defence = await R.defenceFor(s, o ? { q: o.tile_q, r: o.tile_r } : at);
    if (active) {
      const rf = await require('../lib/raid_extras').reinforcementDefence((t, p) => query(t, p), active.id);
      defence.reinforcements = rf.value;
      defence.reinforcement_list = rf.citizens.map(c => ({ id: c.id, name: c.name, role: c.role }));
    }
    const loseIfUndefended = Object.fromEntries(['food', 'timber', 'stone', 'metal', 'wealth'].map(k => [k, Math.floor(Math.min(R.STEAL_CAP, (Number(s[k]) || 0) * R.FULL_SHARE))]));
    res.json({
      ok: true, active, recent, defence, tribute: R.tributeQuote(s, active), full_raid: loseIfUndefended,
      threat: target ? { in_reach: true, from: target.from.name, target: target.name, distance: target.d } : { in_reach: false },
      rules: { warn_hours: R.WARN_H, reach: R.REACH, cooldown_hours: R.COOLDOWN_H, militia: R.MILITIA, days_per_raid: R.DAYS_PER_RAID },
    });
  } catch (e) { console.error('[raids] get', e); res.status(500).json({ error: 'Failed to load raids.' }); }
});

// GET /calls — raids on clanmates' spots on clan land you can help hold.
router.get('/calls', requireAuth, async (req, res) => {
  try { res.json({ ok: true, calls: await require('../lib/raid_extras').openCalls(req.user.userId) }); }
  catch (e) { console.error('[raids] calls', e); res.status(500).json({ error: 'Failed to load calls to arms.' }); }
});

// POST /:id/reinforce { citizen_id } — answer a call to arms.
router.post('/:id/reinforce', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/raid_extras').reinforce(req.user.userId, parseInt(req.params.id, 10), parseInt(req.body && req.body.citizen_id, 10))) }); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[raids] reinforce', e); res.status(500).json({ error: 'Failed to send them.' }); }
});

// POST /tribute — pay the Withered for 24 hours of peace (turns back a raid on its way, at double).
router.post('/tribute', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await R.payTribute(req.user.userId)) }); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[raids] tribute', e); res.status(500).json({ error: 'Failed to pay the tribute.' }); }
});

// POST /admin/peace-clear — Dev Tools: forget any tribute peace and streak.
router.post('/admin/peace-clear', requireAuth, requireAdmin, async (req, res) => {
  try { await query('UPDATE settlements SET raid_peace_until = NULL, raid_tribute_at = NULL, raid_tribute_streak = 0 WHERE user_id=$1', [req.user.userId]); res.json({ ok: true }); }
  catch (e) { console.error('[raids] peace-clear', e); res.status(500).json({ error: 'Failed.' }); }
});

router.post('/admin/send', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const minutes = Number(req.body && req.body.minutes);
    const raid = await R.start(s, { force: true, arriveInMs: Number.isFinite(minutes) ? Math.max(0, minutes) * 60000 : undefined });
    if (!raid) return res.status(400).json({ error: 'A raid is already on its way (or your town has no home tile).' });
    res.json({ ok: true, raid: R.view(raid) });
  } catch (e) { console.error('[raids] send', e); res.status(500).json({ error: 'Failed.' }); }
});

router.post('/admin/resolve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const open = await R.activeFor(s.id);
    if (!open) return res.status(400).json({ error: 'No raid on its way.' });
    await query('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [open.id]);
    const done = await R.resolve(open.id);
    res.json({ ok: true, raid: R.view(done) });
  } catch (e) { console.error('[raids] resolve', e); res.status(500).json({ error: 'Failed.' }); }
});

module.exports = router;
