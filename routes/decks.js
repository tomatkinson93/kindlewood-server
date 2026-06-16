/**
 * routes/decks.js  (server)
 *
 * Deploys to: routes/decks.js
 * Register in index.js:
 *     const deckRoutes = require('./routes/decks');
 *     app.use('/api/decks', deckRoutes);
 *
 * Manages settlement battle deck templates. Cards are settlement-owned and
 * survive citizen death. The combat resolver calls getActiveDeckMap() to fetch
 * the { cardKey: count } map for the next battle.
 */
const express = require('express');
const router = express.Router();
const { query } = require('../db');
const CARD_DEFS = require('../lib/card_definitions');

// auth.js exports the middleware directly: module.exports = function requireAuth.
const requireAuth = require('../middleware/auth');

// --- helpers ---------------------------------------------------------------
async function getSettlement(userId) {
  const r = await query('SELECT id FROM settlements WHERE user_id=$1', [userId]);
  return r.rows[0] || null;
}

async function getUnlockedSet(settlementId) {
  const r = await query(
    'SELECT card_key FROM settlement_unlocked_cards WHERE settlement_id=$1',
    [settlementId]
  );
  return new Set(r.rows.map((row) => row.card_key));
}

// Validate a { cardKey: count } map: keys must exist as defs AND be unlocked,
// counts must be positive integers. Returns { ok, clean, error }.
function validateDeckMap(map, unlockedSet) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, error: 'cards must be an object of { cardKey: count }' };
  }
  const clean = {};
  let total = 0;
  for (const key of Object.keys(map)) {
    if (!CARD_DEFS.getCard(key)) return { ok: false, error: `unknown card: ${key}` };
    if (!unlockedSet.has(key)) return { ok: false, error: `card not unlocked: ${key}` };
    const n = parseInt(map[key], 10);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `bad count for ${key}` };
    if (n > 0) { clean[key] = n; total += n; }
  }
  if (total < 1) return { ok: false, error: 'deck must contain at least 1 card' };
  if (total > 60) return { ok: false, error: 'deck too large (max 60)' };
  return { ok: true, clean };
}

// Server-side resolution used by the combat resolver. Returns the active
// template's card map, falling back to the default deck if none exists.
async function getActiveDeckMap(settlementId) {
  const r = await query(
    `SELECT cards FROM settlement_deck_templates
     WHERE settlement_id=$1 AND is_active=true LIMIT 1`,
    [settlementId]
  );
  if (r.rows.length && r.rows[0].cards) return r.rows[0].cards;
  return CARD_DEFS.DEFAULT_DECK;
}

// --- routes ----------------------------------------------------------------

// GET /api/decks — list templates + unlocked cards + full card catalog
router.get('/', requireAuth, async (req, res) => {
  try {
    const sett = await getSettlement(req.user.userId);
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const [templates, unlocked] = await Promise.all([
      query(
        `SELECT id, name, cards, is_active, updated_at
         FROM settlement_deck_templates WHERE settlement_id=$1 ORDER BY id`,
        [sett.id]
      ),
      getUnlockedSet(sett.id),
    ]);

    // Expose card metadata so the client can render names/costs/desc without
    // shipping the effect functions (which it gets from card-definitions.js).
    const catalog = {};
    Object.keys(CARD_DEFS.CARDS).forEach((k) => {
      const c = CARD_DEFS.CARDS[k];
      catalog[k] = { key: c.key, name: c.name, cost: c.cost, type: c.type, desc: c.desc };
    });

    res.json({
      templates: templates.rows,
      unlocked: Array.from(unlocked),
      catalog,
    });
  } catch (e) {
    console.error('GET /api/decks error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/decks — create a template { name, cards }
router.post('/', requireAuth, async (req, res) => {
  try {
    const sett = await getSettlement(req.user.userId);
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const { name, cards } = req.body || {};
    const unlocked = await getUnlockedSet(sett.id);
    const v = validateDeckMap(cards, unlocked);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const r = await query(
      `INSERT INTO settlement_deck_templates (settlement_id, name, cards, is_active)
       VALUES ($1, $2, $3, false) RETURNING id, name, cards, is_active`,
      [sett.id, (name || 'Untitled').slice(0, 60), JSON.stringify(v.clean)]
    );
    res.json({ ok: true, template: r.rows[0] });
  } catch (e) {
    console.error('POST /api/decks error', e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/decks/:id — update a template's name/cards
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const sett = await getSettlement(req.user.userId);
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const id = parseInt(req.params.id, 10);

    const own = await query(
      'SELECT id FROM settlement_deck_templates WHERE id=$1 AND settlement_id=$2',
      [id, sett.id]
    );
    if (!own.rows.length) return res.status(404).json({ error: 'Template not found.' });

    const { name, cards } = req.body || {};
    const unlocked = await getUnlockedSet(sett.id);
    const v = validateDeckMap(cards, unlocked);
    if (!v.ok) return res.status(400).json({ error: v.error });

    const r = await query(
      `UPDATE settlement_deck_templates
       SET name=$1, cards=$2, updated_at=now()
       WHERE id=$3 AND settlement_id=$4
       RETURNING id, name, cards, is_active`,
      [(name || 'Untitled').slice(0, 60), JSON.stringify(v.clean), id, sett.id]
    );
    res.json({ ok: true, template: r.rows[0] });
  } catch (e) {
    console.error('PUT /api/decks/:id error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/decks/:id/activate — make this template the active one
router.post('/:id/activate', requireAuth, async (req, res) => {
  try {
    const sett = await getSettlement(req.user.userId);
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const id = parseInt(req.params.id, 10);

    const own = await query(
      'SELECT id FROM settlement_deck_templates WHERE id=$1 AND settlement_id=$2',
      [id, sett.id]
    );
    if (!own.rows.length) return res.status(404).json({ error: 'Template not found.' });

    // Deactivate all, then activate the chosen one. Partial unique index makes
    // the two-step necessary to avoid a transient double-active conflict.
    await query(
      'UPDATE settlement_deck_templates SET is_active=false WHERE settlement_id=$1 AND is_active=true',
      [sett.id]
    );
    await query(
      'UPDATE settlement_deck_templates SET is_active=true, updated_at=now() WHERE id=$1',
      [id]
    );
    res.json({ ok: true, active_id: id });
  } catch (e) {
    console.error('POST /api/decks/:id/activate error', e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/decks/:id — cannot delete the last/active template
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const sett = await getSettlement(req.user.userId);
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const id = parseInt(req.params.id, 10);

    const all = await query(
      'SELECT id, is_active FROM settlement_deck_templates WHERE settlement_id=$1',
      [sett.id]
    );
    if (all.rows.length <= 1) return res.status(400).json({ error: 'Cannot delete your only deck.' });
    const row = all.rows.find((r) => r.id === id);
    if (!row) return res.status(404).json({ error: 'Template not found.' });
    if (row.is_active) return res.status(400).json({ error: 'Activate another deck before deleting this one.' });

    await query('DELETE FROM settlement_deck_templates WHERE id=$1 AND settlement_id=$2', [id, sett.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/decks/:id error', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.getActiveDeckMap = getActiveDeckMap;
