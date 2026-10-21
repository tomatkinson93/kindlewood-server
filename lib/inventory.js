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
  // Equipment is one row per piece (each can be equipped on its own).
  if (item.equip_slot && qty > 1) {
    let last = null;
    for (let i = 0; i < qty; i++) last = await grantItem(q, settlementId, { ...item, quantity: 1 });
    return { stacked: false, quantity: qty, item: last && last.item };
  }
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
       (settlement_id, item_key, name, description, icon, category, rarity, quantity, equip_slot, stat_bonuses, source, metadata, tradeable)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      settlementId, item.item_key, item.name,
      item.description || '', item.icon || '📦',
      item.category || 'misc', item.rarity || 'common',
      qty,
      item.equip_slot || null,
      JSON.stringify(item.stat_bonuses || {}),
      item.source || null,
      JSON.stringify(item.metadata || {}),
      item.tradeable !== false,
    ]
  );
  return { stacked: false, quantity: qty, item: r.rows[0] };
}

// The parts of an inventory row that travel with it (Market escrow and
// delivery) — enough for grantItem to recreate it elsewhere.
function snapshotOf(row) {
  return {
    item_key: row.item_key, name: row.name, description: row.description || '',
    icon: row.icon || '📦', category: row.category || 'misc', rarity: row.rarity || 'common',
    equip_slot: row.equip_slot || null, stat_bonuses: row.stat_bonuses || {},
    metadata: row.metadata || {},
  };
}

// Why a row can't be traded (Market or otherwise), or null when it can.
// `template` is its item_templates row, if any.
function untradeableReason(row, template) {
  if (row.tradeable === false || (template && template.tradeable === false)) return 'This item cannot be traded.';
  if (row.equipped_to) return 'Unequip it first.';
  return null;
}

// Takes `qty` of inventory row invId out of settlementId's inventory inside
// transaction client `db` (row locked FOR UPDATE): decrements the stack, or
// deletes the row when it's all taken. Refuses untradeable or equipped
// items. → snapshot of what was taken (see snapshotOf), or throws an Error
// whose .status is 400/404.
async function takeItem(db, settlementId, invId, qty) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  const row = (await db.query(
    'SELECT * FROM inventory_items WHERE id = $1 AND settlement_id = $2 FOR UPDATE', [invId, settlementId])).rows[0];
  if (!row) throw fail(404, 'That item is not in your inventory.');
  const tpl = (await db.query('SELECT tradeable FROM item_templates WHERE item_key = $1', [row.item_key])).rows[0];
  const why = untradeableReason(row, tpl);
  if (why) throw fail(400, why);
  if (!Number.isInteger(qty) || qty <= 0) throw fail(400, 'Invalid quantity.');
  if (qty > row.quantity) throw fail(400, `You only have ${row.quantity} ${row.name}.`);
  if (qty === row.quantity) await db.query('DELETE FROM inventory_items WHERE id = $1', [row.id]);
  else await db.query('UPDATE inventory_items SET quantity = quantity - $2 WHERE id = $1', [row.id, qty]);
  return snapshotOf(row);
}

// Takes `qty` of item_key from across a settlement's tradeable, unequipped
// stacks (equipment is one row per piece) inside transaction `db`, oldest
// first. → snapshot of the first stack taken, or throws (.status 400).
async function takeItemsByKey(db, settlementId, itemKey, qty) {
  const fail = (status, msg) => Object.assign(new Error(msg), { status });
  const tpl = (await db.query('SELECT tradeable FROM item_templates WHERE item_key = $1', [itemKey])).rows[0];
  if (tpl && tpl.tradeable === false) throw fail(400, 'This item cannot be traded.');
  const rows = (await db.query(
    `SELECT * FROM inventory_items WHERE settlement_id = $1 AND item_key = $2 AND equipped_to IS NULL AND tradeable
      ORDER BY obtained_at, id FOR UPDATE`, [settlementId, itemKey])).rows;
  const have = rows.reduce((n, r) => n + r.quantity, 0);
  if (!Number.isInteger(qty) || qty <= 0) throw fail(400, 'Invalid quantity.');
  if (qty > have) throw fail(400, have ? `You only have ${have} to spare.` : 'You have none to spare.');
  let left = qty;
  for (const r of rows) {
    if (!left) break;
    const n = Math.min(left, r.quantity);
    if (n === r.quantity) await db.query('DELETE FROM inventory_items WHERE id = $1', [r.id]);
    else await db.query('UPDATE inventory_items SET quantity = quantity - $2 WHERE id = $1', [r.id, n]);
    left -= n;
  }
  return snapshotOf(rows[0]);
}

module.exports = { grantItem, takeItem, takeItemsByKey, snapshotOf, untradeableReason };
