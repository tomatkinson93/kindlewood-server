const { query } = require('./db');

const DEFAULT_ITEMS = [
  // Fish
  { item_key:'fish_minnow', name:'Minnow', icon:'🐟', category:'fish', rarity:'common', sell_value:2, food_value:3, fish_difficulty:1, fish_weight:60, fish_value:2, fish_seasons:['spring','summer','autumn','winter'], fish_flavour:'A small, darting thing. Common but plentiful.' },
  { item_key:'fish_gudgeon', name:'Gudgeon', icon:'🐟', category:'fish', rarity:'common', sell_value:2, food_value:3, fish_difficulty:1, fish_weight:55, fish_value:2, fish_seasons:['spring','summer','autumn'], fish_flavour:'Barely worth the trouble, but the river is full of them.' },
  { item_key:'fish_dace', name:'Dace', icon:'🐠', category:'fish', rarity:'common', sell_value:4, food_value:5, fish_difficulty:2, fish_weight:45, fish_value:4, fish_seasons:['spring','summer','winter'], fish_flavour:'Quick and silver-sided.' },
  { item_key:'fish_perch', name:'Perch', icon:'🐠', category:'fish', rarity:'common', sell_value:5, food_value:6, fish_difficulty:2, fish_weight:40, fish_value:5, fish_seasons:['spring','summer','autumn'], fish_flavour:'Spiny and stubborn.' },
  { item_key:'fish_roach', name:'Roach', icon:'🐟', category:'fish', rarity:'common', sell_value:4, food_value:5, fish_difficulty:2, fish_weight:42, fish_value:4, fish_seasons:['spring','autumn','winter'], fish_flavour:'Red-finned and restless.' },
  { item_key:'fish_trout', name:'Trout', icon:'🐡', category:'fish', rarity:'uncommon', sell_value:10, food_value:8, fish_difficulty:4, fish_weight:22, fish_value:10, fish_seasons:['spring','autumn','winter'], fish_flavour:'A strong swimmer. Worth the effort.' },
  { item_key:'fish_chub', name:'Chub', icon:'🐡', category:'fish', rarity:'uncommon', sell_value:8, food_value:7, fish_difficulty:3, fish_weight:28, fish_value:8, fish_seasons:['summer','autumn'], fish_flavour:'Thick-bodied and suspicious.' },
  { item_key:'fish_catfish', name:'Catfish', icon:'🐊', category:'fish', rarity:'uncommon', sell_value:14, food_value:9, fish_difficulty:5, fish_weight:18, fish_value:14, fish_seasons:['summer','autumn'], fish_flavour:'Bottom-dwelling and fierce.' },
  { item_key:'fish_bream', name:'Bream', icon:'🐡', category:'fish', rarity:'uncommon', sell_value:11, food_value:8, fish_difficulty:4, fish_weight:20, fish_value:11, fish_seasons:['spring','summer'], fish_flavour:'Deep-bodied and slow to start, then suddenly wild.' },
  { item_key:'fish_pike', name:'Pike', icon:'🦷', category:'fish', rarity:'uncommon', sell_value:18, food_value:10, fish_difficulty:6, fish_weight:14, fish_value:18, fish_seasons:['autumn','winter'], fish_flavour:'Teeth like needles.' },
  { item_key:'fish_salmon', name:'Salmon', icon:'🍣', category:'fish', rarity:'rare', sell_value:28, food_value:18, fish_difficulty:7, fish_weight:8, fish_value:28, fish_seasons:['autumn'], fish_flavour:'Runs against the current with furious strength.' },
  { item_key:'fish_eel', name:'River Eel', icon:'〰️', category:'fish', rarity:'rare', sell_value:25, food_value:15, fish_difficulty:7, fish_weight:9, fish_value:25, fish_seasons:['summer','autumn'], fish_flavour:'Writhes and twists.' },
  { item_key:'fish_golden_carp', name:'Golden Carp', icon:'✨', category:'fish', rarity:'rare', sell_value:35, food_value:20, fish_difficulty:8, fish_weight:5, fish_value:35, fish_seasons:['winter'], fish_flavour:'Gleams beneath the ice.' },
  { item_key:'fish_shadowfin', name:'Shadowfin', icon:'🌑', category:'fish', rarity:'legendary', sell_value:60, food_value:40, fish_difficulty:9, fish_weight:2, fish_value:60, fish_seasons:['autumn','winter'], fish_flavour:'Dark as river-bottom mud.' },
  { item_key:'fish_moontrout', name:'Moontrout', icon:'🌕', category:'fish', rarity:'legendary', sell_value:100, food_value:55, fish_difficulty:10, fish_weight:1, fish_value:100, fish_seasons:['winter'], fish_flavour:'Said to swim only on clear winter nights.' },
  // Weapons
  { item_key:'iron_sword', name:'Iron Sword', icon:'⚔️', category:'equipment', rarity:'common', quality:'sturdy', equip_slot:'weapon', sell_value:20, damage_dice:'1d6', damage_bonus:0, stat_bonuses:{combat:2} },
  { item_key:'steel_sword', name:'Steel Sword', icon:'🗡️', category:'equipment', rarity:'rare', quality:'fine', equip_slot:'weapon', sell_value:55, damage_dice:'1d8', damage_bonus:2, stat_bonuses:{combat:4} },
  { item_key:'hunters_dagger', name:"Hunter's Dagger", icon:'🔪', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'weapon', sell_value:30, damage_dice:'1d4', damage_bonus:1, stat_bonuses:{combat:2,scouting:1} },
  // Armour
  { item_key:'leather_armour', name:'Leather Armour', icon:'🛡️', category:'equipment', rarity:'common', quality:'basic', equip_slot:'armour', sell_value:18, armor_class:2, stat_bonuses:{combat:1} },
  { item_key:'chainmail', name:'Chainmail', icon:'🔗', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'armour', sell_value:40, armor_class:4, stat_bonuses:{combat:2} },
  { item_key:'dragonscale_armour', name:'Dragonscale Armour', icon:'🐉', category:'equipment', rarity:'epic', quality:'fine', equip_slot:'armour', sell_value:120, armor_class:8, stat_bonuses:{combat:5,scouting:2} },
  { item_key:'hunters_cloak', name:"Hunter's Cloak", icon:'🧥', category:'equipment', rarity:'rare', quality:'fine', equip_slot:'armour', sell_value:60, armor_class:3, stat_bonuses:{scouting:2,combat:1} },
  // Tools/Trinkets
  { item_key:'scouts_cloak', name:"Scout's Cloak", icon:'🧥', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'trinket', sell_value:35, stat_bonuses:{scouting:3} },
  { item_key:'fishers_rod', name:"Fisher's Rod", icon:'🎣', category:'equipment', rarity:'uncommon', quality:'sturdy', equip_slot:'tool', sell_value:25, stat_bonuses:{fishing:3} },
  // Materials
  { item_key:'timber_bundle', name:'Timber Bundle', icon:'🪵', category:'material', rarity:'common', sell_value:5 },
  { item_key:'iron_ore', name:'Iron Ore', icon:'⚫', category:'material', rarity:'common', sell_value:8 },
  { item_key:'rare_sap', name:'Rare Sap', icon:'🫙', category:'material', rarity:'uncommon', sell_value:20 },
  { item_key:'ancient_heartwood', name:'Ancient Heartwood', icon:'🪵', category:'material', rarity:'rare', sell_value:45 },
  { item_key:'gemstone', name:'Gemstone', icon:'💎', category:'material', rarity:'rare', sell_value:50 },
  // Quest items
  { item_key:'luminous_scale', name:'Luminous Scale', icon:'✨', category:'quest_item', rarity:'rare', sell_value:40 },
  { item_key:'ancient_blueprint', name:'Ancient Blueprint', icon:'📜', category:'quest_item', rarity:'epic', sell_value:80 },
  { item_key:'blightbane_herb', name:'Blightbane Herb', icon:'🌿', category:'material', rarity:'rare', sell_value:35 },
  // Trophies
  { item_key:'beast_horn', name:'Beast Horn', icon:'📯', category:'trophy', rarity:'uncommon', sell_value:30 },
  { item_key:'ancient_coin', name:'Ancient Coin', icon:'🪙', category:'trophy', rarity:'rare', sell_value:40 },
  { item_key:'dragon_tooth', name:'Dragon Tooth', icon:'🦷', category:'trophy', rarity:'epic', sell_value:100 },
];

function rarityOrder(r) {
  return { common:1, uncommon:2, rare:3, epic:4, legendary:5 }[r] || 1;
}

async function seedItemTemplates() {
  let count = 0;
  for (const item of DEFAULT_ITEMS) {
    const exists = await query('SELECT item_key FROM item_templates WHERE item_key=$1', [item.item_key]);
    if (exists.rows.length) continue;
    await query(`INSERT INTO item_templates
      (item_key,name,description,icon,category,rarity,rarity_order,quality,equip_slot,
       stat_bonuses,sell_value,food_value,fish_seasons,fish_difficulty,fish_weight,
       fish_value,fish_flavour,armor_class,damage_dice,damage_bonus)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [item.item_key, item.name, item.description||'', item.icon||'📦', item.category||'misc',
     item.rarity||'common', rarityOrder(item.rarity), item.quality||'basic',
     item.equip_slot||null, JSON.stringify(item.stat_bonuses||{}),
     item.sell_value||0, item.food_value||0,
     item.fish_seasons ? JSON.stringify(item.fish_seasons) : null,
     item.fish_difficulty||null, item.fish_weight||null, item.fish_value||null, item.fish_flavour||null,
     item.armor_class||null, item.damage_dice||null, item.damage_bonus||0]);
    count++;
  }
  return count;
}

module.exports = { seedItemTemplates };
