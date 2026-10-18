// ══════════════════════════════════════════════════════════════════════════
//  inventory — the one place items enter a settlement's inventory.
//
//  Every grant comes from a server-side decision (a landed catch, a quest or
//  battle reward, an admin's Dev Tools action). There is no player-facing
//  "add item" endpoint: callers build the item from server data, never from
//  a request body.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

// Adds item to settlementId's inventory, stacking non-equipment onto an
// existing unequipped stack with the same item_key. q = db.query or a
// transaction client's query. → { stacked, quantity, item? }
async function grantItem(q, settlementId, item) {
  const qty = Math.max(1, parseInt(item.quantity) || 1);
  if (!item.equip_slot) {
    const existing = await q(
      'SELECT id, quantity FROM inventory_items WHERE settlement_id=$1 AND item_key=$2 AND equipped_to IS NULL',
      [settlementId, item.item_key]
    );
    if (existing.rows.length) {
      const newQty = existing.rows[0].quantity + qty;
      await q('UPDATE inventory_items SET quantity=$1 WHERE id=$2', [newQty, existing.rows[0].id]);
      return { stacked: true, quantity: newQty };
    }
  }
  const r = await q(
    `INSERT INTO inventory_items
       (settlement_id, item_key, name, description, icon, category, rarity, quantity, equip_slot, stat_bonuses, source, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      settlementId, item.item_key, item.name,
      item.description || '', item.icon || '📦',
      item.category || 'misc', item.rarity || 'common',
      qty,
      item.equip_slot || null,
      JSON.stringify(item.stat_bonuses || {}),
      item.source || null,
      JSON.stringify(item.metadata || {}),
    ]
  );
  return { stacked: false, quantity: qty, item: r.rows[0] };
}

module.exports = { grantItem };
