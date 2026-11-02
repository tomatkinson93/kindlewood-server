// ══════════════════════════════════════════════════════════════════════════
//  /api/raids — soft raids by the Withered (lib/raids).
//
//  GET  /               the raid on its way (if any), recent raids, your
//                       defence, and whether the Withered can reach you
//  GET  /calls          raids on clanmates' clan-land spots you can help hold
//  POST /:id/reinforce  { citizen_id } send a Guard/Archer to hold one
//  POST /:id/sally      { citizen_ids } meet them in a card battle first
//  GET  /camps          Withered camps you have found · POST /camps/:id/assault { citizen_ids }
//  POST /tribute        24 hours of peace (escalating; turns back a raid on its way at double)
//  Dev Tools (admins):
//  GET  /admin/status   the raid on its way (exact strength), peace, cooldown,
//                       why the normal check would skip you, your outposts
//  POST /admin/send     raiders gather now { outpost_id | 'town', minutes, strength }
//  POST /admin/cancel   call the raid off: no outcome, no loss, no cooldown
//  POST /admin/resolve  the raid on its way strikes now
//  POST /admin/check    roll the normal raid check for you { boost } (×chance)
//  POST /admin/clear-cooldown  forget the cooldown and tribute peace
//  POST /admin/peace-clear     forget tribute peace
//  POST /admin/camps · /admin/camps/clear   spawn / clear Withered camps
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

// POST /:id/sally { citizen_ids } — meet the raiders in a card battle first.
router.post('/:id/sally', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/raid_camps').startSally(req.user.userId, parseInt(req.params.id, 10), req.body && req.body.citizen_ids)) }); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[raids] sally', e); res.status(500).json({ error: 'Failed to sally out.' }); }
});

// GET /camps — Withered camps you have discovered (within reach to assault, or not).
router.get('/camps', requireAuth, async (req, res) => {
  try {
    const C = require('../lib/raid_camps');
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const seen = new Set((await query('SELECT tile_q, tile_r FROM fog_of_war WHERE user_id=$1', [req.user.userId])).rows.map(t => `${t.tile_q},${t.tile_r}`));
    const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
    const camps = (await C.openCamps()).filter(c => seen.has(`${c.q},${c.r}`)).map(c => ({
      id: c.id, q: c.q, r: c.r, village: c.village, strength_min: Math.round(c.strength * 0.8), strength_max: Math.round(c.strength * 1.2),
      distance: s.tile_q != null ? dist({ q: s.tile_q, r: s.tile_r }, c) : null,
      in_reach: s.tile_q != null && dist({ q: s.tile_q, r: s.tile_r }, c) <= C.ASSAULT_RANGE, under_attack: !!c.run_id,
    }));
    res.json({ ok: true, camps, rules: { assault_range: C.ASSAULT_RANGE, peace_range: C.PEACE_RANGE, peace_hours: C.PEACE_H, party_max: 4 } });
  } catch (e) { console.error('[raids] camps', e); res.status(500).json({ error: 'Failed to load camps.' }); }
});

// POST /camps/:id/assault { citizen_ids } — attack a camp (party card battle).
router.post('/camps/:id/assault', requireAuth, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/raid_camps').startAssault(req.user.userId, parseInt(req.params.id, 10), req.body && req.body.citizen_ids)) }); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); console.error('[raids] assault', e); res.status(500).json({ error: 'Failed to attack the camp.' }); }
});

// POST /admin/camps — Dev Tools: spawn camps now.
router.post('/admin/camps', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, spawned: await require('../lib/raid_camps').spawnCamps() }); }
  catch (e) { console.error('[raids] spawn', e); res.status(500).json({ error: 'Failed.' }); }
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
    const b = req.body || {};
    const minutes = b.minutes === '' || b.minutes == null ? NaN : Number(b.minutes);
    const strength = Math.max(0, Math.round(Number(b.strength) || 0)) || undefined;
    const outpostId = b.outpost_id && b.outpost_id !== 'town' ? parseInt(b.outpost_id, 10) : null;
    if (outpostId && !(await query('SELECT 1 FROM outposts WHERE id=$1 AND settlement_id=$2', [outpostId, s.id])).rows.length) return res.status(404).json({ error: 'That is not one of your outposts.' });
    const raid = await R.start(s, { force: true, outpostId, town: b.outpost_id === 'town', strength, arriveInMs: Number.isFinite(minutes) ? Math.max(0, minutes) * 60000 : undefined });
    if (!raid) return res.status(400).json({ error: 'A raid is already on its way (or your town has no home tile).' });
    res.json({ ok: true, raid: R.view(raid), strength: raid.strength });
  } catch (e) { console.error('[raids] send', e); res.status(500).json({ error: 'Failed.' }); }
});

router.post('/admin/cancel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const open = await R.activeFor(s.id);
    if (!open) return res.status(400).json({ error: 'No raid on its way.' });
    await R.cancel(open.id);
    res.json({ ok: true, cancelled: open.id });
  } catch (e) { console.error('[raids] cancel', e); res.status(500).json({ error: 'Failed.' }); }
});

router.get('/admin/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const raw = (await query('SELECT * FROM settlement_raids WHERE settlement_id=$1 AND resolved_at IS NULL ORDER BY id DESC LIMIT 1', [s.id])).rows[0];
    const last = (await query('SELECT MAX(resolved_at) AS t FROM settlement_raids WHERE settlement_id=$1', [s.id])).rows[0].t;
    const { OUTPOST_CONFIG } = require('../outposts_config');
    const outposts = (await query('SELECT id, terrain, level FROM outposts WHERE settlement_id=$1 ORDER BY id', [s.id])).rows
      .map(o => ({ id: o.id, name: `${(OUTPOST_CONFIG[o.terrain] || {}).name || 'Outpost'} (Lv ${o.level || 1})` }));
    const C = require('../lib/raid_camps');
    res.json({
      ok: true,
      active: raw ? { id: raw.id, target: raw.target_name, from: raw.from_name, strength: raw.strength, arrives_at: raw.arrives_at, outpost_id: raw.outpost_id } : null,
      peace_until: s.raid_peace_until && Date.parse(s.raid_peace_until) > Date.now() ? s.raid_peace_until : null,
      cooldown_until: R.cooldownUntil(last), why_not: await R.whyNot(s), chance: R.CHECK_CHANCE,
      camps: (await C.openCamps()).length, outposts,
    });
  } catch (e) { console.error('[raids] status', e); res.status(500).json({ error: 'Failed.' }); }
});

// POST /admin/check { boost } — the normal check, for you, with the chance × boost.
router.post('/admin/check', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const reasons = await R.whyNot(s);
    if (reasons.length) return res.json({ ok: true, started: false, reasons });
    const boost = Math.max(1, Math.min(10000, Number(req.body && req.body.boost) || 1));
    const chance = Math.min(1, R.CHECK_CHANCE * boost);
    const roll = Math.random();
    if (roll >= chance) return res.json({ ok: true, started: false, chance, roll, reasons: [`The dice said no (rolled ${roll.toFixed(3)}, needed under ${chance.toFixed(3)}).`] });
    const raid = await R.start(s, {});
    res.json({ ok: true, started: !!raid, chance, roll, raid: raid ? R.view(raid) : null, reasons: raid ? [] : ['The raid could not set out.'] });
  } catch (e) { console.error('[raids] check', e); res.status(500).json({ error: 'Failed.' }); }
});

// POST /admin/clear-cooldown — push past raids beyond the cooldown and drop tribute peace.
router.post('/admin/clear-cooldown', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    await query(`UPDATE settlement_raids SET resolved_at = NOW() - make_interval(hours => $2 + 1)
                  WHERE settlement_id=$1 AND resolved_at > NOW() - make_interval(hours => $2 + 1)`, [s.id, R.COOLDOWN_H]);
    await query('UPDATE settlements SET raid_peace_until = NULL, raid_tribute_at = NULL, raid_tribute_streak = 0 WHERE id=$1', [s.id]);
    res.json({ ok: true });
  } catch (e) { console.error('[raids] clear-cooldown', e); res.status(500).json({ error: 'Failed.' }); }
});

// POST /admin/camps/clear — remove every Withered camp (they respawn on the next spawn).
router.post('/admin/camps/clear', requireAuth, requireAdmin, async (req, res) => {
  try { const r = await query('DELETE FROM withered_camps'); res.json({ ok: true, cleared: r.rowCount }); }
  catch (e) { console.error('[raids] camps clear', e); res.status(500).json({ error: 'Failed.' }); }
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
