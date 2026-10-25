// ══════════════════════════════════════════════════════════════════════════
//  CRAFTING — /api/crafting (lib/crafting)
//
//  GET    /station/:station        smithy | jeweller | workshop: crafters, recipes, odds inputs, queue
//  POST   /jobs                    { citizen_id, recipe_key, qty, name?, list?: { markup } }  queue (materials reserved)
//  DELETE /jobs/:id                cancel (materials refunded exactly)
//  POST   /schematics/:id/study    study a schematic (inventory id): the town learns its recipe
//  Dev Tools (admin):
//  GET    /admin/recipes           every recipe, archived too
//  POST   /admin/recipes           { recipe_key, ...fields }
//  PATCH  /admin/recipes/:key      { ...fields }
//  DELETE /admin/recipes/:key      archive (queued jobs keep their snapshot)
//  POST   /admin/recipes/:key/teach  your town learns a hidden recipe
// ══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const crafting = require('../lib/crafting');

const router = express.Router();

async function mySettlementId(userId) {
  const r = await query('SELECT id FROM settlements WHERE user_id = $1', [userId]);
  if (!r.rows[0]) throw new crafting.CraftError(404, 'No settlement.');
  return r.rows[0].id;
}
function send(res, e, fallback) {
  if (e && e.status) return res.status(e.status).json({ error: e.message });
  console.error('[crafting]', e);
  res.status(500).json({ error: fallback });
}

router.get('/station/:station', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    res.json({ ok: true, ...(await crafting.stationState(sid, String(req.params.station))) });
  } catch (e) { send(res, e, 'Could not load the workshop.'); }
});

router.post('/jobs', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const b = req.body || {};
    const out = await crafting.queueJobs(sid, {
      citizenId: parseInt(b.citizen_id, 10), recipeKey: String(b.recipe_key || ''), qty: b.qty == null ? 1 : b.qty,
      name: b.name ? String(b.name) : null,
      list: b.list && typeof b.list === 'object' ? { markup: Number(b.list.markup) } : null,
    });
    res.json({ ok: true, ...out });
  } catch (e) { send(res, e, 'Could not queue that.'); }
});

router.delete('/jobs/:id', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new crafting.CraftError(400, 'Bad job id.');
    res.json({ ok: true, ...(await crafting.cancelJob(sid, id)) });
  } catch (e) { send(res, e, 'Could not cancel that.'); }
});

router.post('/schematics/:id/study', requireAuth, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) throw new crafting.CraftError(400, 'Bad item id.');
    res.json({ ok: true, ...(await crafting.studySchematic(sid, id)) });
  } catch (e) { send(res, e, 'Could not study that.'); }
});

router.post('/admin/recipes/:key/teach', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sid = await mySettlementId(req.user.userId);
    res.json({ ok: true, learned: await crafting.teachRecipe(sid, String(req.params.key)) });
  } catch (e) { send(res, e, 'Could not teach that.'); }
});

router.get('/admin/recipes', requireAuth, requireAdmin, async (req, res) => {
  try {
    const r = await query('SELECT * FROM recipes ORDER BY class_key, sort_order, min_level, recipe_key');
    res.json({ ok: true, recipes: r.rows });
  } catch (e) { send(res, e, 'Could not load recipes.'); }
});

router.post('/admin/recipes', requireAuth, requireAdmin, async (req, res) => {
  try {
    await crafting.saveRecipe(String((req.body || {}).recipe_key || ''), req.body || {}, true);
    res.json({ ok: true });
  } catch (e) {
    if (e && e.code === '23505') return res.status(409).json({ error: 'A recipe with that key exists.' });
    send(res, e, 'Could not save the recipe.');
  }
});

router.patch('/admin/recipes/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    await crafting.saveRecipe(String(req.params.key), req.body || {}, false);
    res.json({ ok: true });
  } catch (e) { send(res, e, 'Could not save the recipe.'); }
});

router.delete('/admin/recipes/:key', requireAuth, requireAdmin, async (req, res) => {
  try {
    const u = await query('UPDATE recipes SET archived = TRUE, updated_at = NOW() WHERE recipe_key = $1', [String(req.params.key)]);
    if (!u.rowCount) throw new crafting.CraftError(404, 'No such recipe.');
    res.json({ ok: true });
  } catch (e) { send(res, e, 'Could not archive the recipe.'); }
});

module.exports = router;
