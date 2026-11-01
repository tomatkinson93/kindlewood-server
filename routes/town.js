// ══════════════════════════════════════════════════════════════════════════
//  TOWN — /api/town: festivals and the town's own bonuses (lib/town_mods.js).
//
//  GET  /                  { festival, upkeep, arrears, sources }
//  POST /festival          spend wealth + food: 24h of +happiness and +production
//  Dev Tools (admin):
//  POST /admin/festival    start one free and clear the cooldown
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { query } = require('../db');
const T = require('../lib/town_mods');

const router = express.Router();
const mine = async userId => (await query('SELECT * FROM settlements WHERE user_id = $1', [userId])).rows[0];
const view = async s => { const t = await T.load(null, s); return { festival: t.festival, upkeep: t.upkeep, arrears: t.arrears, sources: t.sources }; };

router.get('/', requireAuth, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    res.json({ ok: true, ...(await view(s)) });
  } catch (e) { console.error('[town]', e); res.status(500).json({ error: 'Could not load the town.' }); }
});

async function startFestival(s, free) {
  const cost = free ? { wealth: 0, food: 0 } : T.festivalCost(s.tier);
  // One statement: enough in the stores, nothing running, cooldown over.
  const r = await query(
    `UPDATE settlements SET wealth = wealth - $2, food = food - $3,
            festival_started_at = NOW(), festival_until = NOW() + make_interval(hours => $4),
            festival_cooldown_until = NOW() + make_interval(hours => $5)
      WHERE id = $1 AND wealth >= $2 AND food >= $3
        AND (festival_until IS NULL OR festival_until <= NOW())
        AND ($6 OR festival_cooldown_until IS NULL OR festival_cooldown_until <= NOW())
      RETURNING *`,
    [s.id, cost.wealth, cost.food, T.FESTIVAL.hours, T.FESTIVAL.cooldown_hours, !!free]);
  if (r.rowCount) {
    await query("INSERT INTO settlement_events (settlement_id, type, message) VALUES ($1,'festival',$2)",
      [s.id, `🎉 A festival fills the streets! For ${T.FESTIVAL.hours} hours: +${T.FESTIVAL.happiness} happiness and +${Math.round(T.FESTIVAL.production * 100)}% production.`]);
  }
  return r.rows[0] || null;
}

router.post('/festival', requireAuth, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const before = await T.load(null, s);
    if (!before.festival.can_start) return res.status(400).json({ error: before.festival.why || 'Not now.' });
    const after = await startFestival(s, false);
    if (!after) return res.status(409).json({ error: 'The stores changed — try again.' });
    res.json({ ok: true, ...(await view(after)), resources: { wealth: Number(after.wealth), food: Number(after.food) } });
  } catch (e) { console.error('[town] festival', e); res.status(500).json({ error: 'Could not start the festival.' }); }
});

router.post('/admin/festival', requireAuth, requireAdmin, async (req, res) => {
  try {
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    await query('UPDATE settlements SET festival_until = NULL, festival_cooldown_until = NULL WHERE id = $1', [s.id]);
    const after = await startFestival({ ...s, festival_until: null }, true);
    res.json({ ok: true, ...(await view(after || s)) });
  } catch (e) { console.error('[town] admin festival', e); res.status(500).json({ error: 'Could not start it.' }); }
});

module.exports = router;
