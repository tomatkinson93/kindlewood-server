// ══════════════════════════════════════════════════════════════════════════
//  HAPPENINGS ROUTES (spec 021 Phase 6) — mounted at /api/happenings.
//
//  GET  /schedule            no auth, cached 60s. Enabled definitions; the
//                            client computes windows itself with the shared
//                            day_cycle.windowsBetween (no SSE needed).
//  GET  /active              the server's view at gameplayNow(req.user).
//  Admin (requireAuth + requireAdmin):
//  GET  /admin               every definition (archived too) + fairness
//  POST /admin               create
//  PUT  /admin/:id           update (id is fixed)
//  POST /admin/:id/archive   { archived: true|false } (default true)
//  Rules are validated by the shared day_cycle.validateRule; a rewarding
//  Happening that fails the fairness check (day_cycle.fairnessOf) saves with
//  a warning, never a block.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const D = require('../lib/day_cycle');
const H = require('../lib/happenings');
const HFX = require('../lib/happening_effects');
const { gameplayNow, wallNow } = require('../lib/server_clock');

const router = express.Router();
const FIELDS = 'id, title, flavour, icon, rule, effects, rewarding, enabled, archived, sort_order';
const publicDef = (h) => ({ id: h.id, title: h.title, flavour: h.flavour, icon: h.icon, rule: h.rule, effects: h.effects, rewarding: h.rewarding });

function fairness(h) {
  const f = D.fairnessOf(h.rule, wallNow());
  return { warn: !!h.rewarding && f.warn, startHours: f.startHours, longestMs: f.longestMs, exempt: f.exempt, coverage: f.coverage };
}

router.get('/schedule', async (req, res) => {
  try {
    const defs = await H.loadLive(query);
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ ok: true, now: wallNow(), happenings: defs.map(publicDef) });
  } catch (e) { res.status(500).json({ error: 'Could not load the schedule.' }); }
});

router.get('/active', requireAuth, async (req, res) => {
  try {
    const at = gameplayNow(req.user);
    const active = H.activeAt(await H.loadLive(query), at);
    res.set('Cache-Control', 'no-store');
    // effects: this window's resolved effects (a random_modifier shows the
    // stat + value it rolled); modifiers: the summed totals now in force.
    res.json({ ok: true, at, modifiers: HFX.modifiersAt(await H.loadLive(query), at),
               active: active.map(h => ({ ...publicDef(h), effects: h.resolvedEffects, window: h.window })) });
  } catch (e) { res.status(500).json({ error: 'Could not load active Happenings.' }); }
});

// ── Admin ────────────────────────────────────────────────────────────────
router.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT ${FIELDS} FROM happenings ORDER BY archived, sort_order, id`);
    res.json({ ok: true, happenings: r.rows.map(h => ({ ...h, fairness: fairness(h) })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin', requireAuth, requireAdmin, async (req, res) => {
  let h;
  try { h = H.validateHappening(req.body, true); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const dupe = await query('SELECT id FROM happenings WHERE id=$1', [h.id]);
    if (dupe.rows.length) return res.status(400).json({ error: 'A Happening with that id already exists.' });
    await query(
      `INSERT INTO happenings (id, title, flavour, icon, rule, effects, rewarding, enabled, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [h.id, h.title, h.flavour, h.icon, JSON.stringify(h.rule), JSON.stringify(h.effects), h.rewarding, h.enabled, h.sort_order]);
    H.invalidate();
    res.json({ ok: true, happening: h, fairness: fairness(h) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/admin/:id', requireAuth, requireAdmin, async (req, res) => {
  let h;
  try { h = H.validateHappening({ ...req.body, id: req.params.id }, false); } catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const r = await query(
      `UPDATE happenings SET title=$1, flavour=$2, icon=$3, rule=$4, effects=$5, rewarding=$6, enabled=$7,
              sort_order=$8, updated_at=NOW() WHERE id=$9`,
      [h.title, h.flavour, h.icon, JSON.stringify(h.rule), JSON.stringify(h.effects), h.rewarding, h.enabled, h.sort_order, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Happening not found.' });
    H.invalidate();
    res.json({ ok: true, happening: { ...h, id: req.params.id }, fairness: fairness(h) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/admin/:id/archive', requireAuth, requireAdmin, async (req, res) => {
  try {
    const archived = !(req.body && req.body.archived === false);
    const r = await query('UPDATE happenings SET archived=$1, updated_at=NOW() WHERE id=$2', [archived, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Happening not found.' });
    H.invalidate();
    res.json({ ok: true, id: req.params.id, archived });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
