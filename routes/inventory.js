// ══════════════════════════════════════════════
//  INVENTORY ROUTES
// ══════════════════════════════════════════════
const express     = require('express');
const { query }   = require('../db');
const requireAuth = require('../middleware/auth');
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

// ── POST /api/inventory/add — add item(s) to inventory ──
router.post('/add', requireAuth, async (req, res) => {
  try {
    const { item_key, name, description, icon, category, rarity, quantity, equip_slot, stat_bonuses, source, metadata } = req.body;
    if (!item_key || !name) return res.status(400).json({ error: 'item_key and name required.' });

    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    // Stack if item is stackable (non-equipment) and already exists
    if (!equip_slot) {
      const existing = await query(
        'SELECT id, quantity FROM inventory_items WHERE settlement_id=$1 AND item_key=$2 AND equipped_to IS NULL',
        [sett.id, item_key]
      );
      if (existing.rows.length) {
        const newQty = existing.rows[0].quantity + (parseInt(quantity) || 1);
        await query('UPDATE inventory_items SET quantity=$1 WHERE id=$2', [newQty, existing.rows[0].id]);
        return res.json({ ok: true, stacked: true, quantity: newQty });
      }
    }

    const result = await query(
      `INSERT INTO inventory_items
         (settlement_id, item_key, name, description, icon, category, rarity, quantity, equip_slot, stat_bonuses, source, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        sett.id, item_key, name,
        description || '', icon || '📦',
        category || 'misc', rarity || 'common',
        parseInt(quantity) || 1,
        equip_slot || null,
        JSON.stringify(stat_bonuses || {}),
        source || null,
        JSON.stringify(metadata || {})
      ]
    );
    res.json({ ok: true, item: result.rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/inventory/:id — update item (equip, unequip, qty) ──
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const item = await query('SELECT * FROM inventory_items WHERE id=$1 AND settlement_id=$2', [req.params.id, sett.id]);
    if (!item.rows[0]) return res.status(404).json({ error: 'Item not found.' });

    const { equipped_to, quantity } = req.body;
    const updates = [], vals = [];
    let i = 1;

    if (equipped_to !== undefined) {
      updates.push(`equipped_to=$${i++}`);
      vals.push(equipped_to || null);
    }
    if (quantity !== undefined) {
      updates.push(`quantity=$${i++}`);
      vals.push(Math.max(0, parseInt(quantity)));
    }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

    vals.push(req.params.id, sett.id);
    await query(`UPDATE inventory_items SET ${updates.join(',')} WHERE id=$${i++} AND settlement_id=$${i}`, vals);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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


// ── POST /api/inventory/:id/sell — sell item for gold ──
router.post('/:id/sell', requireAuth, async (req, res) => {
  try {
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });

    const itemRes = await query(
      'SELECT * FROM inventory_items WHERE id=$1 AND settlement_id=$2',
      [req.params.id, sett.id]
    );
    const item = itemRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Item not found.' });

    // Calculate sell value — use metadata.sell_value if present, else 1 per item
    const meta = item.metadata || {};
    const sellPerUnit = meta.sell_value || 1;
    const totalGold = sellPerUnit * (item.quantity || 1);

    // Award gold and remove item
    await query('UPDATE settlements SET wealth = wealth + $1 WHERE id=$2', [totalGold, sett.id]);
    await query('DELETE FROM inventory_items WHERE id=$1', [item.id]);

    res.json({ ok: true, gold_awarded: totalGold });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
