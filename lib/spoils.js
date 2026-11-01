// ══════════════════════════════════════════════════════════════════════════
//  spoils — what a won battle really leaves you: the loot the engine rolled
//  from each defeated enemy (seeded, so the server's replay is the truth —
//  the client's claim is never used) and, now and then, a new combat card
//  (lib/cards). Granted once, by whoever moved the battle to 'resolved'.
//
//  grant(db, sid, { drops, enemies, seedKey }) → { items: [{ item_key, name,
//    icon, qty }], card: { key, name, rarity } | null }
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { grantItem } = require('./inventory');

async function grant(db, sid, { drops, enemies, seedKey }) {
  const out = { items: [], card: null };
  const list = (drops || []).filter(d => d && d.item && d.qty > 0).slice(0, 20);
  if (list.length) {
    const tpls = (await db.query('SELECT * FROM item_templates WHERE item_key = ANY($1::text[])', [list.map(d => d.item)])).rows;
    for (const d of list) {
      const t = tpls.find(x => x.item_key === d.item);
      if (!t) continue;   // an enemy's loot names an item that no longer exists
      await grantItem((q, p) => db.query(q, p), sid, {
        item_key: t.item_key, name: t.name, description: t.description || '', icon: t.icon || '📦',
        category: t.category || 'misc', rarity: t.rarity || 'common', quantity: Math.min(99, d.qty),
        equip_slot: t.equip_slot || null, stat_bonuses: t.stat_bonuses || {}, source: 'battle',
        metadata: { sell_value: t.sell_value, food_value: t.food_value, armor_class: t.armor_class, damage_dice: t.damage_dice },
        tradeable: t.tradeable !== false,
      });
      out.items.push({ item_key: t.item_key, name: t.name, icon: t.icon || '📦', qty: Math.min(99, d.qty) });
    }
  }
  const rng = require('./clan_quests').seededRng(`spoils:${seedKey}`);
  out.card = await require('./cards').rollBattle(db, sid, enemies || [], rng, 'battle');
  return out;
}

module.exports = { grant };
