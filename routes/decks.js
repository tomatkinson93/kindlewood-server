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
let CARD_REGISTRY = null;
try { CARD_REGISTRY = require('../lib/card_registry'); } catch (e) {}

// Load DB cards into the registry so deck validation/catalog see custom cards.
async function _ensureCards() {
  if (!CARD_REGISTRY) return;
  try {
    const r = await query('SELECT * FROM card_templates');
    if (r.rows && r.rows.length) CARD_REGISTRY.loadRows(r.rows);
  } catch (e) { /* table may not exist yet; fall back to code cards */ }
}
function _getCard(key) {
  if (CARD_REGISTRY && CARD_REGISTRY.getCard(key)) return CARD_REGISTRY.getCard(key);
  return CARD_DEFS.getCard(key);
}
function _allCards() {
  if (CARD_REGISTRY && CARD_REGISTRY.allCards) return CARD_REGISTRY.allCards();
  return CARD_DEFS.CARDS;
}

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

// Validate a { cardKey: count } map: keys must exist as defs (unlock check is
// currently disabled for testing — any defined card may be added). Counts must
// be positive integers. Deck size must be 12–30. Returns { ok, clean, error }.
function validateDeckMap(map, unlockedSet) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { ok: false, error: 'cards must be an object of { cardKey: count }' };
  }
  const clean = {};
  let total = 0;
  for (const key of Object.keys(map)) {
    if (!_getCard(key)) return { ok: false, error: `unknown card: ${key}` };
    // Unlock requirement intentionally disabled for now (testing); re-enable by
    // uncommenting: if (!unlockedSet.has(key)) return { ok:false, error:`card not unlocked: ${key}` };
    const n = parseInt(map[key], 10);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: `bad count for ${key}` };
    if (n > 0) { clean[key] = n; total += n; }
  }
  if (total < 12) return { ok: false, error: `deck must have at least 12 cards (has ${total})` };
  if (total > 30) return { ok: false, error: `deck cannot exceed 30 cards (has ${total})` };
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
    await _ensureCards();
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

    // Expose full card metadata (registry-aware) so the deck builder can show
    // every available card with its cost/type/target/art.
    const all = _allCards();
    const catalog = {};
    Object.keys(all).forEach((k) => {
      const c = all[k];
      catalog[k] = { key: c.key, name: c.name, cost: c.cost, type: c.type, target: c.target, desc: c.desc, rarity: c.rarity, art_url: c.art_url || null };
    });

    res.json({
      templates: templates.rows,
      unlocked: Array.from(unlocked),
      catalog,
      deck_min: 12,
      deck_max: 30,
    });
  } catch (e) {
    console.error('GET /api/decks error', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/decks — create a template { name, cards }
router.post('/', requireAuth, async (req, res) => {
  try {
    await _ensureCards();
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
    await _ensureCards();
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
