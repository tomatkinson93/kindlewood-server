// ══════════════════════════════════════════════════════════════════════════
//  spoils — loot into the stores.
//
//  grantItems(db, sid, drops, source) → [{ item_key, name, icon, qty }]
//    What the foes of a won battle carried (lib/tactics_quests.js), and a
//    dungeon run's held loot when it ends (lib/dungeons.js).
//
//  (A won battle also used to give a new combat card now and then. The cards
//  went with the card battler on 2026-11-26.)
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { grantItem } = require('./inventory');

// Loot into the stores: [{ item, qty }] → [{ item_key, name, icon, qty }].
// An entry naming an item that no longer exists is skipped.
async function grantItems(db, sid, drops, source = 'battle') {
  const items = [];
  const list = (drops || []).filter(d => d && d.item && d.qty > 0).slice(0, 20);
  if (list.length) {
    const tpls = (await db.query('SELECT * FROM item_templates WHERE item_key = ANY($1::text[])', [list.map(d => d.item)])).rows;
    for (const d of list) {
      const t = tpls.find(x => x.item_key === d.item);
      if (!t) continue;   // an enemy's loot names an item that no longer exists
      await grantItem((q, p) => db.query(q, p), sid, {
        item_key: t.item_key, name: t.name, description: t.description || '', icon: t.icon || '📦',
        category: t.category || 'misc', rarity: t.rarity || 'common', quantity: Math.min(99, d.qty),
        equip_slot: t.equip_slot || null, stat_bonuses: t.stat_bonuses || {}, source,
        metadata: { sell_value: t.sell_value, food_value: t.food_value, armor_class: t.armor_class, damage_dice: t.damage_dice },
        tradeable: t.tradeable !== false,
      });
      items.push({ item_key: t.item_key, name: t.name, icon: t.icon || '📦', qty: Math.min(99, d.qty) });
    }
  }
  return items;
}

module.exports = { grantItems };
