const express    = require('express');
const { query }  = require('../db');
const requireAuth = require('../middleware/auth');
const router = express.Router();

// ── GET /api/item-admin — list all item templates ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const r = await query('SELECT * FROM item_templates ORDER BY category, rarity_order, name');
    res.json({ ok: true, items: r.rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/item-admin — create item template ──
router.post('/', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    if (!d.item_key || !d.name) return res.status(400).json({ error: 'item_key and name required.' });
    const exists = await query('SELECT item_key FROM item_templates WHERE item_key=$1', [d.item_key]);
    if (exists.rows.length) return res.status(400).json({ error: 'item_key already exists.' });

    await query(`INSERT INTO item_templates
      (item_key, name, description, icon, category, rarity, rarity_order, quality,
       equip_slot, stat_bonuses, metadata, sell_value, food_value,
       fish_seasons, fish_difficulty, fish_weight, fish_value, fish_flavour,
       armor_class, damage_dice, damage_bonus, item_effects)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [d.item_key, d.name, d.description||'', d.icon||'📦', d.category||'misc',
     d.rarity||'common', _rarityOrder(d.rarity), d.quality||'basic',
     d.equip_slot||null, JSON.stringify(d.stat_bonuses||{}), JSON.stringify(d.metadata||{}),
     d.sell_value||0, d.food_value||0,
     d.fish_seasons ? JSON.stringify(d.fish_seasons) : null,
     d.fish_difficulty||null, d.fish_weight||null, d.fish_value||null, d.fish_flavour||null,
     d.armor_class||null, d.damage_dice||null, d.damage_bonus||0,
     JSON.stringify(d.item_effects||[])]);

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PATCH /api/item-admin/:key — update item template ──
router.patch('/:key', requireAuth, async (req, res) => {
  try {
    const d = req.body;
    const jsonFields = ['stat_bonuses','metadata','fish_seasons','item_effects'];
    const sets = [], vals = [];
    let i = 1;
    const allowed = ['name','description','icon','category','rarity','quality','equip_slot',
      'stat_bonuses','metadata','sell_value','food_value','fish_seasons','fish_difficulty',
      'fish_weight','fish_value','fish_flavour','armor_class','damage_dice','damage_bonus','item_effects'];
    for (const f of allowed) {
      if (d[f] === undefined) continue;
      sets.push(`${f}=$${i++}`);
      vals.push(jsonFields.includes(f) ? JSON.stringify(d[f]) : d[f]);
    }
    if (d.rarity) { sets.push(`rarity_order=$${i++}`); vals.push(_rarityOrder(d.rarity)); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    vals.push(req.params.key);
    await query(`UPDATE item_templates SET ${sets.join(',')} WHERE item_key=$${i}`, vals);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── DELETE /api/item-admin/:key ──
router.delete('/:key', requireAuth, async (req, res) => {
  try {
    await query('DELETE FROM item_templates WHERE item_key=$1', [req.params.key]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/item-admin/:key/spawn — add item to player inventory ──
router.post('/:key/spawn', requireAuth, async (req, res) => {
  try {
    const qty = parseInt(req.body.quantity) || 1;
    const settRes = await query('SELECT id FROM settlements WHERE user_id=$1', [req.user.userId]);
    const sett = settRes.rows[0];
    if (!sett) return res.status(404).json({ error: 'No settlement.' });
    const tmpl = await query('SELECT * FROM item_templates WHERE item_key=$1', [req.params.key]);
    if (!tmpl.rows.length) return res.status(404).json({ error: 'Item not found.' });
    const t = tmpl.rows[0];
    await query(`INSERT INTO inventory_items
      (settlement_id,item_key,name,description,icon,category,rarity,quantity,equip_slot,stat_bonuses,source,metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'admin',$11)
      ON CONFLICT DO NOTHING`,
      [sett.id, t.item_key, t.name, t.description, t.icon, t.category, t.rarity, qty,
       t.equip_slot, JSON.stringify(t.stat_bonuses||{}),
       JSON.stringify({ sell_value: t.sell_value, food_value: t.food_value,
                        armor_class: t.armor_class, damage_dice: t.damage_dice })]);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function _rarityOrder(r) {
  return { common:1, uncommon:2, rare:3, epic:4, legendary:5 }[r] || 1;
}

module.exports = router;
