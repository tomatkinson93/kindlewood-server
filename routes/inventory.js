// ══════════════════════════════════════════════
//  INVENTORY ROUTES
// ══════════════════════════════════════════════
const express     = require('express');
const { query, withTransaction } = require('../db');
const requireAuth = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');
const { grantItem } = require('../lib/inventory');
const router      = express.Router();

// ── GET /api/inventory — fetch all items for settlement ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const items = await query(
      `SELECT i.*, c.name as equipped_to_name
       FROM inventory_items i
       LEFT JOIN citizens c ON c.id = i.equipped_to
       WHERE i.settlement_id = $1
       ORDER BY i.category, i.rarity DESC, i.obtained_at DESC`,
      [sett.id]
    );
    res.json({ ok: true, items: items.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/inventory/cheat/add — Dev Tools: add an item (admins only) ──
// There is deliberately no player-facing add: items enter inventories only
// through server-side grants (lib/inventory.js) — fishing lands via
// /api/fishing/land, quests and battles grant on the server.
router.post('/cheat/add', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.item_key || !b.name) return res.status(400).json({ error: 'item_key and name required.' });
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const r = await grantItem(query, sett.id, {
      item_key: b.item_key, name: b.name, description: b.description, icon: b.icon, category: b.category,
      rarity: b.rarity, quantity: b.quantity, equip_slot: b.equip_slot, stat_bonuses: b.stat_bonuses,
      source: b.source || 'dev_tools', metadata: b.metadata,
    });
    res.json({ ok: true, ...r });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/inventory/:id — equip / unequip ──
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    // Equip / unequip only. Quantity is never client-settable (it would let a
    // player inflate a stack and sell it). Gear counts now (careers): one
    // piece per slot, adults only, and never swapped while someone is away.
    const { equipped_to } = req.body || {};
    if (equipped_to === undefined) return res.status(400).json({ error: 'Nothing to update.' });
    const careers = require('../lib/careers');
    const away = await careers.awayMap(null, sett.id);
    const err = (status, msg) => Object.assign(new Error(msg), { status });
    const out = await withTransaction(async client => {
      const item = (await client.query('SELECT * FROM inventory_items WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [req.params.id, sett.id])).rows[0];
      if (!item) throw err(404, 'Item not found.');
      if (item.equipped_to && away.has(item.equipped_to)) throw err(400, 'They are away with that — wait until they are home.');
      if (!equipped_to) {
        await client.query('UPDATE inventory_items SET equipped_to = NULL WHERE id = $1', [item.id]);
        return { replaced: null };
      }
      if (!item.equip_slot) throw err(400, 'That can\'t be equipped.');
      if ((item.quantity || 1) > 1) throw err(400, 'Equip one piece at a time.');
      const c = (await client.query('SELECT id, name, life_stage FROM citizens WHERE id=$1 AND settlement_id=$2 FOR UPDATE', [equipped_to, sett.id])).rows[0];
      if (!c) throw err(400, 'That citizen is not in your settlement.');
      if ((c.life_stage || 'adult') !== 'adult') throw err(400, `${c.name} can't use gear.`);
      if (away.has(c.id)) throw err(400, `${c.name} is away — equip them when they are home.`);
      // Swap: whatever they had in that slot goes back to the stores.
      const prev = (await client.query(
        'UPDATE inventory_items SET equipped_to = NULL WHERE equipped_to = $1 AND equip_slot = $2 AND id <> $3 RETURNING name',
        [c.id, item.equip_slot, item.id])).rows[0];
      await client.query('UPDATE inventory_items SET equipped_to = $1 WHERE id = $2', [c.id, item.id]);
      return { replaced: prev ? prev.name : null };
    });
    res.json({ ok: true, replaced: out.replaced });
  } catch(e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/inventory/:id — remove item ──
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    await query('DELETE FROM inventory_items WHERE id=$1 AND settlement_id=$2', [req.params.id, sett.id]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// ── POST /api/inventory/:id/sell — retired ──
// Instant selling to the town is gone: sell to Ironhaven by porter (low
// prices) or to other players at the Market (/api/market).
router.post('/:id/sell', requireAuth, (req, res) => {
  res.status(410).json({ error: 'Instant selling has moved: sell to Ironhaven or list it at the Market.' });
});

module.exports = router;
