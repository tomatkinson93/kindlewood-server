/**
 * routes/card_admin.js  (server)
 *
 * Deploys to: routes/card_admin.js
 * Register in index.js:
 *     const cardAdminRoutes = require('./routes/card_admin');
 *     app.use('/api/card-admin', cardAdminRoutes);
 *
 * Full CRUD for card_templates, plus a public-ish list the client uses to load
 * the card registry for rendering. Mirrors routes/item_admin.js conventions.
 * Formula strings are validated on save so the editor can surface errors.
 */
const express = require('express');
const { query } = require('../db');
const requireAuth = require('../middleware/auth');
const FORMULA = require('../lib/card_formula');

const router = express.Router();

const CARD_TYPES = ['attack', 'defense', 'support', 'magic'];
const TARGETS = ['self', 'enemy', 'ally', 'ally_or_self', 'any', 'all_enemies', 'all_allies', 'none'];
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

function rarityOrder(r) {
  return { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 }[r] || 1;
}

// Validate a formula; returns { ok, errors }.
function validateFormula(formula) {
  const parsed = FORMULA.parseFormula(formula || '');
  return { ok: parsed.errors.length === 0, errors: parsed.errors };
}

// ── GET /api/card-admin — list all card templates ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM card_templates ORDER BY rarity_order, card_type, name');
    res.json({ ok: true, cards: r.rows, help: FORMULA.HELP, card_types: CARD_TYPES, targets: TARGETS, rarities: RARITIES });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/card-admin — create a card ──
router.post('/', requireAuth, async (req, res) => {
  try {
    const d = req.body || {};
    if (!d.card_key || !d.name) return res.status(400).json({ error: 'card_key and name required.' });
    if (!/^[a-z0-9_]+$/.test(d.card_key)) return res.status(400).json({ error: 'card_key must be snake_case (a-z, 0-9, _).' });
    const exists = await query('SELECT card_key FROM card_templates WHERE card_key=$1', [d.card_key]);
    if (exists.rows.length) return res.status(400).json({ error: 'card_key already exists.' });

    const fv = validateFormula(d.formula);
    if (!fv.ok) return res.status(400).json({ error: 'Formula errors: ' + fv.errors.join(' '), formula_errors: fv.errors });
    if (CARD_TYPES.indexOf(d.card_type) === -1) return res.status(400).json({ error: 'Invalid card_type.' });
    if (TARGETS.indexOf(d.target) === -1) return res.status(400).json({ error: 'Invalid target.' });

    await query(`INSERT INTO card_templates
      (card_key, name, cost, card_type, target, rarity, rarity_order, description, formula, art_url, sfx, hit, pierce_count, pierce_falloff, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [d.card_key, d.name, (d.cost | 0), d.card_type, d.target,
       d.rarity || 'common', rarityOrder(d.rarity), d.description || '',
       d.formula || '', d.art_url || null, d.sfx || null,
       d.hit || 'choose', (d.pierce_count != null ? (d.pierce_count | 0) : null),
       (d.pierce_falloff != null ? Number(d.pierce_falloff) : 1.0),
       JSON.stringify(d.metadata || {})]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/card-admin/:key — update a card ──
router.patch('/:key', requireAuth, async (req, res) => {
  try {
    const d = req.body || {};
    if (d.formula !== undefined) {
      const fv = validateFormula(d.formula);
      if (!fv.ok) return res.status(400).json({ error: 'Formula errors: ' + fv.errors.join(' '), formula_errors: fv.errors });
    }
    if (d.card_type !== undefined && CARD_TYPES.indexOf(d.card_type) === -1) return res.status(400).json({ error: 'Invalid card_type.' });
    if (d.target !== undefined && TARGETS.indexOf(d.target) === -1) return res.status(400).json({ error: 'Invalid target.' });

    const allowed = ['name', 'cost', 'card_type', 'target', 'rarity', 'description', 'formula', 'art_url', 'sfx', 'hit', 'pierce_count', 'pierce_falloff', 'metadata'];
    const sets = [], vals = [];
    let i = 1;
    for (const f of allowed) {
      if (d[f] === undefined) continue;
      sets.push(`${f}=$${i++}`);
      vals.push(f === 'metadata' ? JSON.stringify(d[f]) : (f === 'cost' ? (d[f] | 0) : d[f]));
    }
    if (d.rarity !== undefined) { sets.push(`rarity_order=$${i++}`); vals.push(rarityOrder(d.rarity)); }
    sets.push(`updated_at=now()`);
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    vals.push(req.params.key);
    await query(`UPDATE card_templates SET ${sets.join(',')} WHERE card_key=$${i}`, vals);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/card-admin/:key ──
router.delete('/:key', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM card_templates WHERE card_key=$1', [req.params.key]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/card-admin/validate — check a formula without saving ──
router.post('/validate', requireAuth, async (req, res) => {
  const fv = validateFormula((req.body || {}).formula);
  res.json({ ok: fv.ok, errors: fv.errors });
});

module.exports = router;
