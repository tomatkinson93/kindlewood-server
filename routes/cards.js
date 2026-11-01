// ══════════════════════════════════════════════════════════════════════════
//  /api/cards — the card collection (lib/cards).
//
//  GET  /                         owned cards + every card, with how to get it
//  GET  /village/:npcId           this week's cards an Allied village teaches
//  POST /village/:npcId/:cardKey  learn one, for wealth (Allied only)
//  POST /admin/unlock-all         Dev Tools: unlock every card for my town
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { query, withTransaction } = require('../db');
const C = require('../lib/cards');

const router = express.Router();
const ALLIED = 71;

async function mine(userId) {
  return (await query('SELECT id, wealth FROM settlements WHERE user_id=$1', [userId])).rows[0] || null;
}
// Admin cards (card_templates) into the registry, as routes/decks does.
async function ensureCards() {
  try {
    const r = await query('SELECT * FROM card_templates');
    if (r.rows.length) require('../lib/card_registry').loadRows(r.rows);
  } catch (e) { /* registry falls back to the built-in cards */ }
}

router.get('/', requireAuth, async (req, res) => {
  try {
    await ensureCards();
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const owned = await C.ownedSet(s.id);
    const all = C.allCards();
    res.json({
      ok: true, owned: [...owned], starter: C.STARTER, how_to_get: C.HOW,
      cards: Object.keys(all).sort().map(k => ({ ...C.meta(k), owned: owned.has(k), starter: C.STARTER.includes(k) })),
    });
  } catch (e) { console.error('[cards] list', e); res.status(500).json({ error: 'Failed to load cards.' }); }
});

async function villageOffer(s, npcId) {
  const rel = (await query(
    `SELECT n.id, n.name, d.trust FROM npc_settlements n
       JOIN diplomacy_relations d ON d.npc_id = n.id AND d.settlement_id = $1
      WHERE n.id = $2 AND COALESCE(n.disposition,'neutral') <> 'hostile' AND COALESCE(n.faction,'neutral') <> 'hostile'`, [s.id, npcId])).rows[0];
  if (!rel) return { error: 'You have no relations with that village.', status: 404 };
  const owned = await C.ownedSet(s.id);
  const cards = C.villageCards(rel.id).map(k => ({ ...C.meta(k), price: C.priceOf(k), owned: owned.has(k) }));
  return { village: { id: rel.id, name: rel.name, trust: rel.trust }, allied: rel.trust >= ALLIED, cards };
}

router.get('/village/:npcId', requireAuth, async (req, res) => {
  try {
    await ensureCards();
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const o = await villageOffer(s, parseInt(req.params.npcId, 10));
    if (o.error) return res.status(o.status).json({ error: o.error });
    res.json({ ok: true, ...o, needs_trust: ALLIED });
  } catch (e) { console.error('[cards] village', e); res.status(500).json({ error: 'Failed to load the village\'s cards.' }); }
});

router.post('/village/:npcId/:cardKey', requireAuth, async (req, res) => {
  try {
    await ensureCards();
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    const o = await villageOffer(s, parseInt(req.params.npcId, 10));
    if (o.error) return res.status(o.status).json({ error: o.error });
    if (!o.allied) return res.status(403).json({ error: `Only an Allied village (trust ${ALLIED}+) teaches its fighting ways.` });
    const card = o.cards.find(c => c.key === req.params.cardKey);
    if (!card) return res.status(404).json({ error: 'They aren\'t teaching that this week.' });
    if (card.owned) return res.status(400).json({ error: 'Your fighters already know it.' });
    const out = await withTransaction(async client => {
      const paid = await client.query('UPDATE settlements SET wealth = wealth - $2 WHERE id = $1 AND wealth >= $2 RETURNING wealth', [s.id, card.price]);
      if (!paid.rowCount) throw Object.assign(new Error(`Not enough wealth — it costs ${card.price}.`), { status: 400 });
      const got = await C.unlock(client, s.id, card.key, 'village:' + o.village.id);
      if (!got) throw Object.assign(new Error('Your fighters already know it.'), { status: 400 });
      return { card: got, wealth: Number(paid.rows[0].wealth) };
    });
    res.json({ ok: true, ...out, village: o.village.name });
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    console.error('[cards] buy', e); res.status(500).json({ error: 'Failed to learn the card.' });
  }
});

router.post('/admin/unlock-all', requireAuth, requireAdmin, async (req, res) => {
  try {
    await ensureCards();
    const s = await mine(req.user.userId);
    if (!s) return res.status(404).json({ error: 'No settlement.' });
    let n = 0;
    for (const k of C.unlockable()) if (await C.unlock(null, s.id, k, 'admin')) n++;
    res.json({ ok: true, unlocked: n });
  } catch (e) { console.error('[cards] unlock-all', e); res.status(500).json({ error: 'Failed.' }); }
});

module.exports = router;
