// ══════════════════════════════════════════════════════════════════════════
//  CAREER CLASSES — every job a citizen can hold, and its skill tree.
//
//  A class key is the citizen's role string ('farmer', 'soldier'…), except
//  'porter', which is both a role and the class every market porter run
//  trains. Trees: trunk nodes (Lv1–10), two specialisations after the
//  permanent fork at Lv10 (nodes Lv11–19), and a free capstone at Lv20.
//  Classes without a fork run their trunk to Lv20.
//
//  Node ids are stored in player data — never rename one; mark it
//  `retired: true` instead (its points come back automatically).
//  `tier` is the level needed, `lane` its place across the branch (−2…2);
//  together with `branch` they are also the tree layout (js/career-tree.js).
//  Effects use lib/career_math.js EFFECTS; `per` is per rank.
// ══════════════════════════════════════════════════════════════════════════

'use strict';

// n(id, name, icon, tier, lane, maxRank, effects, extra)
const fx = (type, per, param) => (param ? { type, param, per } : { type, per });
function n(id, name, icon, tier, lane, maxRank, effects, extra = {}) {
  return { id, name, icon, tier, lane, maxRank, effects, branch: 'trunk', requires: [], ...extra };
}
const spec = (branch, nodes) => nodes.map(x => ({ ...x, branch }));
const cap = (id, name, icon, effects, extra = {}) => n(id, name, icon, 20, 0, 1, effects, { capstone: true, ...extra });

const CLASSES = {
  forager: {
    label: 'Forager', icon: '🍄', kind: 'gathering', primary: 'endurance', secondary: 'agility', skill: 'farming',
    needs: null, base: { food: 1 }, physical: true,
    desc: 'Gathers berries, nuts and roots from the wild. Needs no building — anyone can forage. A Forager Hut helps (+25% per level).',
    tree: [
      n('forager.berry_eye', 'Berry Eye', '🫐', 2, 0, 3, [fx('output', 0.06)], { desc: 'Spots the ripest bushes first.' }),
      n('forager.light_eater', 'Light Eater', '🥣', 3, 1, 2, [fx('upkeep', -0.08)], { desc: 'Snacks while gathering; eats less at home.' }),
      n('forager.quick_study', 'Quick Study', '📖', 4, -1, 2, [fx('xp', 0.08)]),
      n('forager.winter_larder', 'Winter Larder', '❄️', 5, -1, 2, [fx('season', 0.25, 'winter')], { requires: ['forager.berry_eye'], desc: 'Knows where the squirrels hide their stores.' }),
      n('forager.mushroom_lore', 'Mushroom Lore', '🍄', 6, 1, 2, [fx('find', 0.25, 'blightbane_herb')], { desc: 'Sometimes comes home with rare herbs.' }),
      n('forager.lucky_find', 'Forager\'s Luck', '🍀', 6, -2, 1, [fx('find', 0.3, 'blightbane_herb'), fx('output', 0.05)], { secret: 'green_thumb' }),
      n('forager.wanderers_path', 'Wanderer\'s Path', '🥾', 8, 0, 2, [fx('travel', 0.06)]),
      n('forager.old_paths', 'Old Paths', '🌲', 11, -1, 3, [fx('output', 0.05)], { requires: ['forager.berry_eye'] }),
      n('forager.full_basket', 'Full Basket', '🧺', 13, 1, 2, [fx('find', 0.25, 'blightbane_herb')], { requires: ['forager.mushroom_lore'] }),
      n('forager.thick_skin', 'Thick Skin', '🦔', 15, 0, 2, [fx('injury', -4)]),
      n('forager.snares', 'Hunter\'s Snares', '🪤', 17, -1, 2, [fx('output', 0.05)]),
      cap('forager.bountiful_woods', 'Bountiful Woods', '🌳', [fx('aura', 0.1)], { desc: 'Every forager in the settlement gathers 10% more.' }),
    ],
  },

  farmer: {
    label: 'Farmer', icon: '🌾', kind: 'gathering', primary: 'endurance', secondary: 'strength', skill: 'farming',
    needs: ['farm'], base: { food: 3 }, crew: 'farm', physical: true,
    desc: 'Works the fields. Needs a Farm.',
    fork: [
      { key: 'agronomist', label: 'Agronomist', icon: '🌱', desc: 'Master of crops and seasons: bigger harvests, and fields that keep giving through winter.' },
      { key: 'rancher', label: 'Rancher', icon: '🐑', desc: 'Raises herds: steady food plus hides and wool for future tanners and tailors.' },
    ],
    tree: [
      n('farmer.furrow', 'Furrow & Seed', '🌱', 2, 0, 3, [fx('output', 0.06)]),
      n('farmer.weather_wise', 'Weather-Wise', '🌦️', 3, -1, 2, [fx('season', 0.25, 'winter')], { desc: 'Reads the sky; loses less to the frost.' }),
      n('farmer.field_lunch', 'Field Lunch', '🥪', 4, 1, 2, [fx('upkeep', -0.08)]),
      n('farmer.early_riser', 'Early Riser', '☀️', 5, 0, 2, [fx('xp', 0.08)], { requires: ['farmer.furrow'] }),
      n('farmer.green_fingers', 'Green Fingers', '🪴', 6, -2, 1, [fx('output', 0.1)], { secret: 'green_thumb' }),
      n('farmer.harvest_festival', 'Harvest Festival', '🎃', 7, -1, 2, [fx('season', 0.15, 'autumn')], { requires: ['farmer.weather_wise'] }),
      n('farmer.field_teacher', 'Field Teacher', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('farmer.sturdy_back', 'Sturdy Back', '💪', 9, 0, 1, [fx('stat', 1, 'endurance')]),
      ...spec('agronomist', [
        n('farmer.crop_rotation', 'Crop Rotation', '🔄', 11, 0, 3, [fx('output', 0.06)]),
        n('farmer.cold_frames', 'Cold Frames', '🪟', 13, -1, 2, [fx('season', 0.25, 'winter')], { requires: ['farmer.crop_rotation'] }),
        n('farmer.spring_planting', 'Spring Planting', '🌷', 14, 1, 2, [fx('season', 0.2, 'spring')]),
        n('farmer.soil_lore', 'Soil Lore', '🪱', 16, 0, 2, [fx('output', 0.06)], { requires: ['farmer.crop_rotation'] }),
        n('farmer.almanac', 'Farmer\'s Almanac', '📖', 18, 1, 1, [fx('xp', 0.15)]),
        cap('farmer.golden_fields', 'Golden Fields', '🌾', [fx('output', 0.25), fx('aura', 0.05)], { desc: '+25% output, and every farmer here +5%.' }),
      ]),
      ...spec('rancher', [
        n('farmer.herd_lore', 'Herd Lore', '🐑', 11, 0, 3, [fx('output', 0.05)]),
        n('farmer.tanners_share', 'Tanner\'s Share', '🟫', 12, -1, 2, [fx('find', 0.5, 'hide')]),
        n('farmer.shearing_day', 'Shearing Day', '🧶', 13, 1, 2, [fx('find', 0.5, 'wool')]),
        n('farmer.good_dog', 'Good Dog', '🐕', 15, 0, 2, [fx('output', 0.05), fx('injury', -3)], { requires: ['farmer.herd_lore'] }),
        n('farmer.hardy_stock', 'Hardy Stock', '❄️', 17, -1, 2, [fx('season', 0.3, 'winter')]),
        cap('farmer.prize_herd', 'Prize Herd', '🏆', [fx('output', 0.15), fx('find', 0.15, 'prize_ram')], { desc: '+15% output, and about one Prize Ram a week to sell.' }),
      ]),
    ],
  },

  woodcutter: {
    label: 'Woodcutter', icon: '🪓', kind: 'gathering', primary: 'strength', secondary: 'endurance', skill: 'woodcutting',
    needs: ['lumber_camp'], base: { timber: 4 }, crew: 'lumber_camp', physical: true,
    desc: 'Fells timber. Needs a Lumber Camp.',
    fork: [
      { key: 'forester', label: 'Forester', icon: '🌳', desc: 'Tends the old forest: rare sap and ancient heartwood for master crafters.' },
      { key: 'sawyer', label: 'Sawyer', icon: '🪚', desc: 'Turns trees into timber at speed: the most wood, the fastest.' },
    ],
    tree: [
      n('woodcutter.sharp_axe', 'Sharp Axe', '🪓', 2, 0, 3, [fx('output', 0.06)]),
      n('woodcutter.timber_sense', 'Timber Sense', '🪵', 3, 1, 2, [fx('find', 0.5, 'timber_bundle')]),
      n('woodcutter.steady_swing', 'Steady Swing', '🎯', 4, -1, 2, [fx('injury', -4)]),
      n('woodcutter.heart_of_wood', 'Heart of the Wood', '💚', 6, 2, 1, [fx('find', 0.2, 'rare_sap')], { secret: 'woodwise' }),
      n('woodcutter.woodland_stride', 'Woodland Stride', '👣', 6, -1, 2, [fx('travel', 0.05)]),
      n('woodcutter.long_days', 'Long Days', '🌅', 7, 0, 2, [fx('xp', 0.08)], { requires: ['woodcutter.sharp_axe'] }),
      n('woodcutter.felling_crew', 'Felling Crew', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('woodcutter.oak_shoulders', 'Oak Shoulders', '💪', 9, 0, 1, [fx('stat', 1, 'strength')]),
      ...spec('forester', [
        n('woodcutter.old_growth', 'Old Growth', '🌳', 11, 0, 2, [fx('find', 0.3, 'rare_sap')]),
        n('woodcutter.replanting', 'Replanting', '🌱', 12, -1, 3, [fx('output', 0.05)]),
        n('woodcutter.heartwood_seeker', 'Heartwood Seeker', '🪵', 15, 1, 2, [fx('find', 0.08, 'ancient_heartwood')], { requires: ['woodcutter.old_growth'] }),
        n('woodcutter.forest_whisper', 'Forest Whisper', '🍃', 17, 0, 2, [fx('xp', 0.1)]),
        n('woodcutter.deer_paths', 'Deer Paths', '🦌', 18, -1, 2, [fx('travel', 0.08)]),
        cap('woodcutter.elder_grove', 'Elder Grove', '🌲', [fx('find', 0.15, 'ancient_heartwood'), fx('output', 0.1)], { desc: 'Ancient heartwood about once a week, and +10% output.' }),
      ]),
      ...spec('sawyer', [
        n('woodcutter.saw_pit', 'Saw Pit', '🪚', 11, 0, 3, [fx('output', 0.08)]),
        n('woodcutter.planking', 'Planking', '🪵', 13, 1, 2, [fx('find', 1, 'timber_bundle')]),
        n('woodcutter.efficient_cuts', 'Efficient Cuts', '✂️', 14, -1, 2, [fx('output', 0.05)], { requires: ['woodcutter.saw_pit'] }),
        n('woodcutter.two_man_saw', 'Two-Man Saw', '🤝', 16, 1, 2, [fx('output', 0.04)]),
        n('woodcutter.lumber_boss', 'Lumber Boss', '📣', 17, 0, 2, [fx('aura', 0.04)]),
        cap('woodcutter.mill_master', 'Mill Master', '⚙️', [fx('output', 0.3)], { desc: '+30% timber.' }),
      ]),
    ],
  },

  miner: {
    label: 'Miner', icon: '⛏️', kind: 'gathering', primary: 'strength', secondary: 'endurance', skill: 'mining',
    needs: ['mine'], base: { stone: 3, metal: 2 }, crew: 'mine', physical: true,
    desc: 'Digs stone and ore. Needs a Mine.',
    fork: [
      { key: 'prospector', label: 'Prospector', icon: '💎', desc: 'Follows the veins: iron ore and gemstones turn up again and again.' },
      { key: 'stonemason', label: 'Stonemason', icon: '🧱', desc: 'Cuts stone like butter: far more stone and metal from every shift.' },
    ],
    tree: [
      n('miner.pick_work', 'Pick Work', '⛏️', 2, 0, 3, [fx('output', 0.06)]),
      n('miner.ore_nose', 'Ore Nose', '👃', 3, 1, 2, [fx('find', 0.5, 'iron_ore'), fx('ore', 0.15)]),
      n('miner.cave_safety', 'Cave Safety', '🪔', 4, -1, 2, [fx('injury', -4)]),
      n('miner.stone_song', 'Stone Song', '🎶', 6, -2, 1, [fx('find', 0.08, 'gemstone'), fx('ore', 1, 'gems')], { secret: 'stone_sense' }),
      n('miner.deep_breaths', 'Deep Breaths', '🫁', 6, -1, 2, [fx('upkeep', -0.06)]),
      n('miner.tunnel_sense', 'Tunnel Sense', '🧭', 7, 0, 2, [fx('xp', 0.08)], { requires: ['miner.pick_work'] }),
      n('miner.shift_boss', 'Shift Boss', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('miner.stone_arms', 'Stone Arms', '💪', 9, 0, 1, [fx('stat', 1, 'strength')]),
      ...spec('prospector', [
        n('miner.vein_reading', 'Vein Reading', '🔍', 11, 0, 3, [fx('find', 0.4, 'iron_ore'), fx('ore', 0.25)]),
        n('miner.gem_sight', 'Gem Sight', '💎', 13, 1, 2, [fx('find', 0.1, 'gemstone'), fx('ore', 0.5, 'gems')]),
        n('miner.lucky_strike', 'Lucky Strike', '🍀', 15, -1, 2, [fx('output', 0.05)]),
        n('miner.deep_seams', 'Deep Seams', '🕳️', 17, 0, 2, [fx('find', 0.1, 'gemstone'), fx('ore', 0.5, 'gems')], { requires: ['miner.gem_sight'] }),
        n('miner.assayer', 'Assayer', '⚖️', 18, 1, 2, [fx('xp', 0.1)]),
        cap('miner.motherlode', 'Motherlode', '✨', [fx('find', 0.15, 'gemstone'), fx('find', 0.5, 'iron_ore'), fx('ore', 0.3)], { desc: 'A gemstone about once a week, ore every other day, and +30% copper, tin, silver and rarer finds at the Mine.' }),
      ]),
      ...spec('stonemason', [
        n('miner.clean_cuts', 'Clean Cuts', '🧱', 11, 0, 3, [fx('output', 0.08)]),
        n('miner.dressed_stone', 'Dressed Stone', '🪨', 13, -1, 2, [fx('output', 0.05)], { requires: ['miner.clean_cuts'] }),
        n('miner.masons_lodge', 'Mason\'s Lodge', '🏛️', 14, 1, 2, [fx('aura', 0.04)]),
        n('miner.iron_lungs', 'Iron Lungs', '🫁', 16, 0, 2, [fx('upkeep', -0.06), fx('injury', -3)]),
        n('miner.steady_chisel', 'Steady Chisel', '🔨', 18, -1, 2, [fx('output', 0.04)]),
        cap('miner.master_mason', 'Master Mason', '🏰', [fx('output', 0.3)], { desc: '+30% stone and metal.' }),
      ]),
    ],
  },

  fisher: {
    label: 'Fisher', icon: '🎣', kind: 'gathering', primary: 'agility', secondary: 'endurance', skill: 'fishing',
    needs: ['fishing_post'], base: { food: 2 }, crew: 'fishing_post', physical: true,
    desc: 'Fishes the river for food. Needs a Fishing Post (which also boosts every fisher).',
    fork: [
      { key: 'angler', label: 'Angler', icon: '🐟', desc: 'Patient and cunning: lands rare and legendary fish to eat, sell or show off.' },
      { key: 'netcaster', label: 'Netcaster', icon: '🕸️', desc: 'Hauls in the shoals: the most food, all year round.' },
    ],
    tree: [
      n('fisher.patient_line', 'Patient Line', '🎣', 2, 0, 3, [fx('output', 0.06)]),
      n('fisher.cold_hands', 'Cold Hands', '🧤', 3, -1, 2, [fx('season', 0.25, 'winter')]),
      n('fisher.bait_lore', 'Bait Lore', '🪱', 4, 1, 2, [fx('find', 0.5, 'fish')], { desc: 'Brings home the season\'s fish now and then.' }),
      n('fisher.rivers_gift', 'River\'s Gift', '🌊', 6, 2, 1, [fx('find', 0.1, 'fish_rare')], { secret: 'river_kin' }),
      n('fisher.river_reader', 'River Reader', '🌀', 6, 0, 2, [fx('xp', 0.08)], { requires: ['fisher.patient_line'] }),
      n('fisher.fish_supper', 'Fish Supper', '🍲', 7, -1, 2, [fx('upkeep', -0.08)]),
      n('fisher.old_salt', 'Old Salt', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('fisher.sure_footing', 'Sure Footing', '🦶', 9, 0, 1, [fx('stat', 1, 'agility')]),
      ...spec('angler', [
        n('fisher.rare_bites', 'Rare Bites', '🐠', 11, 0, 2, [fx('find', 0.15, 'fish_rare')]),
        n('fisher.fly_tying', 'Fly Tying', '🪶', 12, 1, 3, [fx('find', 0.4, 'fish')]),
        n('fisher.trophy_hunter', 'Trophy Hunter', '🏆', 15, -1, 2, [fx('find', 0.1, 'fish_rare')], { requires: ['fisher.rare_bites'] }),
        n('fisher.quiet_waters', 'Quiet Waters', '🌫️', 17, 0, 2, [fx('xp', 0.1)]),
        n('fisher.dawn_casts', 'Dawn Casts', '🌅', 18, 1, 2, [fx('output', 0.05)]),
        cap('fisher.legend_of_the_lake', 'Legend of the Lake', '🌕', [fx('find', 0.15, 'fish_legendary')], { desc: 'About once a week, a legendary fish.' }),
      ]),
      ...spec('netcaster', [
        n('fisher.wide_nets', 'Wide Nets', '🕸️', 11, 0, 3, [fx('output', 0.1)]),
        n('fisher.smokehouse', 'Smokehouse', '🔥', 13, -1, 2, [fx('season', 0.3, 'winter')]),
        n('fisher.crew_call', 'Crew Call', '📣', 14, 1, 2, [fx('aura', 0.04)]),
        n('fisher.heavy_haul', 'Heavy Haul', '⚓', 16, 0, 2, [fx('output', 0.06)], { requires: ['fisher.wide_nets'] }),
        n('fisher.weatherwise', 'Weatherwise', '⛈️', 18, -1, 2, [fx('injury', -4)]),
        cap('fisher.fleet', 'Fleet', '⛵', [fx('output', 0.3)], { desc: '+30% food from the river.' }),
      ]),
    ],
  },

  scout: {
    label: 'Scout', icon: '🧭', kind: 'travel', primary: 'agility', secondary: 'intelligence', skill: 'scouting',
    needs: ['scout_post'], base: {}, physical: false,
    desc: 'Explores the map on expeditions. Needs a Scout Post.',
    fork: [
      { key: 'pathfinder', label: 'Pathfinder', icon: '🗺️', desc: 'Maps the world: faster expeditions, wider reveals, quicker envoys.' },
      { key: 'ranger', label: 'Ranger', icon: '🏹', desc: 'A scout who fights: tougher on quests and deadlier in a party.' },
    ],
    tree: [
      n('scout.light_feet', 'Light Feet', '👣', 2, 0, 3, [fx('travel', 0.06)]),
      n('scout.keen_eye', 'Keen Eye', '👁️', 3, 1, 1, [fx('reveal', 1)]),
      n('scout.map_maker', 'Map Maker', '🗺️', 4, -1, 2, [fx('quest', 0.04, 'scouting')]),
      n('scout.trail_rations', 'Trail Rations', '🥖', 5, 1, 2, [fx('upkeep', -0.08)]),
      n('scout.hawks_view', 'Hawk\'s View', '🦅', 6, -2, 1, [fx('reveal', 1)], { secret: 'eagle_eye' }),
      n('scout.quick_study', 'Quick Study', '📖', 6, 0, 2, [fx('xp', 0.08)], { requires: ['scout.light_feet'] }),
      n('scout.scout_master', 'Scout Master', '🧑‍🏫', 8, -1, 2, [fx('mentor', 0.15)]),
      n('scout.nimble', 'Nimble', '🐇', 9, 0, 1, [fx('stat', 1, 'agility')]),
      ...spec('pathfinder', [
        n('scout.trailblazer', 'Trailblazer', '🔥', 11, 0, 3, [fx('travel', 0.06)]),
        n('scout.far_sight', 'Far Sight', '🔭', 13, 1, 1, [fx('reveal', 1)]),
        n('scout.envoys_guide', 'Envoy\'s Guide', '✉️', 14, -1, 2, [fx('envoy', 0.1)]),
        n('scout.surveyor', 'Surveyor', '📐', 16, 0, 2, [fx('quest', 0.05, 'scouting')], { requires: ['scout.trailblazer'] }),
        n('scout.long_road', 'Long Road', '🛤️', 18, 1, 3, [fx('travel', 0.04)]),
        cap('scout.cartographer', 'Cartographer', '🗺️', [fx('reveal', 1), fx('envoy', 0.2)], { desc: 'Expeditions reveal a wider ring; envoys travel 20% faster.' }),
      ]),
      ...spec('ranger', [
        n('scout.bushcraft', 'Bushcraft', '🏕️', 11, 0, 2, [fx('skill', 1, 'combat')]),
        n('scout.ambush', 'Ambush', '🌿', 13, -1, 2, [fx('quest', 0.05, 'combat')]),
        n('scout.hunters_patience', 'Hunter\'s Patience', '⏳', 14, 1, 2, [fx('injury', -5)]),
        n('scout.tracker', 'Tracker', '🐾', 16, 0, 2, [fx('quest', 0.04, 'scouting')], { requires: ['scout.bushcraft'] }),
        n('scout.silent_step', 'Silent Step', '🤫', 18, 1, 3, [fx('travel', 0.04)]),
        cap('scout.warden', 'Warden', '🛡️', [fx('injury', -10), fx('skill', 1, 'combat')], { desc: 'Much harder to hurt, and +1 combat.' }),
      ]),
    ],
  },

  soldier: {
    label: 'Guard', icon: '🛡️', kind: 'combat', primary: 'strength', secondary: 'endurance', skill: 'combat',
    needs: null, base: {}, physical: true,
    desc: 'Trains with sword and shield; fights in quests and battles.',
    tree: [
      n('soldier.drill', 'Drill', '🗡️', 2, 0, 3, [fx('skill', 1, 'combat')]),
      n('soldier.shield_wall', 'Shield Wall', '🛡️', 3, -1, 3, [fx('injury', -4)]),
      n('soldier.toughened', 'Toughened', '🪨', 5, 1, 2, [fx('stat', 1, 'endurance')]),
      n('soldier.second_wind', 'Second Wind', '💨', 6, 2, 1, [fx('stat', 2, 'endurance')], { secret: 'tireless' }),
      n('soldier.night_vigil', 'Night Vigil', '🔥', 6, 0, 2, [fx('happiness', 1)], { desc: 'People sleep easier with a guard at the gate.' }),
      n('soldier.sparring', 'Sparring Partner', '🧑‍🏫', 8, -1, 2, [fx('mentor', 0.15)]),
      n('soldier.iron_will', 'Iron Will', '💪', 10, 1, 2, [fx('stat', 1, 'strength')], { requires: ['soldier.toughened'] }),
      n('soldier.war_stories', 'War Stories', '📜', 12, 0, 2, [fx('xp', 0.1)]),
      n('soldier.veteran_stance', 'Veteran Stance', '⚔️', 14, -1, 2, [fx('quest', 0.05, 'combat')], { requires: ['soldier.drill'] }),
      n('soldier.hold_the_line', 'Hold the Line', '🏰', 16, 1, 2, [fx('injury', -4)]),
      cap('soldier.bulwark', 'Bulwark of the Town', '🏯', [fx('injury', -10), fx('happiness', 2)], { desc: 'Rarely hurt, and the whole settlement feels safer.' }),
    ],
  },

  archer: {
    label: 'Archer', icon: '🏹', kind: 'combat', primary: 'agility', secondary: 'strength', skill: 'combat',
    needs: null, base: {}, physical: true,
    desc: 'Fights from range in quests and battles.',
    tree: [
      n('archer.steady_aim', 'Steady Aim', '🎯', 2, 0, 3, [fx('skill', 1, 'combat')]),
      n('archer.quick_draw', 'Quick Draw', '⚡', 3, 1, 2, [fx('stat', 1, 'agility')]),
      n('archer.hunters_eye', 'Hunter\'s Eye', '👁️', 5, -1, 2, [fx('quest', 0.04, 'combat')]),
      n('archer.eagles_mark', 'Eagle\'s Mark', '🦅', 6, -2, 1, [fx('skill', 1, 'combat')], { secret: 'eagle_eye' }),
      n('archer.light_step', 'Light Step', '👣', 6, 1, 2, [fx('travel', 0.05)]),
      n('archer.range_master', 'Range Master', '🧑‍🏫', 8, -1, 2, [fx('mentor', 0.15)]),
      n('archer.cover', 'Take Cover', '🌳', 10, 0, 2, [fx('injury', -4)]),
      n('archer.volley', 'Volley', '🏹', 12, 1, 2, [fx('quest', 0.04, 'combat')], { requires: ['archer.hunters_eye'] }),
      n('archer.focus', 'Focus', '🧘', 14, -1, 2, [fx('xp', 0.1)]),
      n('archer.eagle_draw', 'Eagle Draw', '💪', 16, 0, 2, [fx('stat', 1, 'agility')], { requires: ['archer.quick_draw'] }),
      n('archer.fletching', 'Fletching', '🪶', 17, 1, 1, [fx('skill', 1, 'combat')]),
      cap('archer.deadeye', 'Deadeye', '🎯', [fx('skill', 2, 'combat')], { desc: '+2 combat.' }),
    ],
  },

  merchant: {
    label: 'Merchant', icon: '⚖️', kind: 'trade', primary: 'charisma', secondary: 'intelligence', skill: 'scouting',
    needs: ['market'], assignedBy: 'market', base: {}, physical: false,
    desc: 'Carries your Market orders to buyers. Assigned from the Market.',
    fork: [
      { key: 'trader', label: 'Trader', icon: '💰', desc: 'Lives for the deal: lower fees and more sell orders.' },
      { key: 'caravan_master', label: 'Caravan Master', icon: '🐫', desc: 'Runs the roads: bigger loads, faster caravans, an extra merchant.' },
    ],
    tree: [
      n('merchant.haggler', 'Haggler', '🪙', 2, 0, 3, [fx('fee', -0.08)]),
      n('merchant.road_smart', 'Road-Smart', '🛣️', 3, 1, 2, [fx('travel', 0.06)]),
      n('merchant.ledger', 'Ledger', '📒', 5, -1, 1, [fx('max_orders', 1)]),
      n('merchant.pack_sense', 'Pack Sense', '🎒', 6, 1, 2, [fx('carry', 0.06)]),
      n('merchant.silver_words', 'Silver Words', '🗣️', 6, 2, 1, [fx('fee', -0.1)], { secret: 'silver_tongue' }),
      n('merchant.friends_abroad', 'Friends Abroad', '🤝', 7, 0, 2, [fx('xp', 0.08)], { requires: ['merchant.haggler'] }),
      n('merchant.apprentice_trader', 'Teaching the Trade', '🧑‍🏫', 8, -1, 2, [fx('mentor', 0.15)]),
      n('merchant.sharp_eye', 'Sharp Eye', '🧐', 9, 0, 1, [fx('stat', 1, 'charisma')]),
      ...spec('trader', [
        n('merchant.silver_ledger', 'Silver Ledger', '📗', 11, 0, 3, [fx('fee', -0.06)]),
        n('merchant.charm_offensive', 'Charm Offensive', '😊', 12, 1, 1, [fx('stat', 1, 'charisma')]),
        n('merchant.market_sense', 'Market Sense', '📈', 13, -1, 1, [fx('max_orders', 1)]),
        n('merchant.guild_ties', 'Guild Ties', '🏛️', 15, 1, 2, [fx('fee', -0.05)], { requires: ['merchant.silver_ledger'] }),
        n('merchant.trade_routes', 'Trade Routes', '🗺️', 17, 0, 2, [fx('xp', 0.1)]),
        cap('merchant.merchant_prince', 'Merchant Prince', '👑', [fx('max_orders', 1), fx('fee', -0.1)], { desc: 'One more sell order, and fees cut further.' }),
      ]),
      ...spec('caravan_master', [
        n('merchant.pack_mules', 'Pack Mules', '🐴', 11, 0, 3, [fx('carry', 0.08)]),
        n('merchant.swift_caravans', 'Swift Caravans', '💨', 13, 1, 2, [fx('travel', 0.08)]),
        n('merchant.spare_wheels', 'Spare Wheels', '🛞', 14, -1, 2, [fx('travel', 0.04)]),
        n('merchant.caravan_lead', 'Caravan Lead', '🚩', 16, 0, 1, [fx('merchants', 1)], { requires: ['merchant.pack_mules'] }),
        n('merchant.load_master', 'Load Master', '📦', 18, 1, 3, [fx('carry', 0.04)]),
        cap('merchant.great_caravan', 'Great Caravan', '🐫', [fx('merchants', 1), fx('carry', 0.1)], { desc: 'An extra merchant slot, and +10% carry.' }),
      ]),
    ],
  },

  shopkeeper: {
    label: 'Shopkeeper', icon: '🏪', kind: 'trade', primary: 'charisma', secondary: 'intelligence', skill: null,
    needs: null, assignedBy: 'market', base: {}, physical: false,
    desc: 'Minds a shop so its stalls stay open. Assigned from the Market\'s Shops tab.',
    tree: [
      n('shopkeeper.patter', 'Patter', '🗣️', 2, 0, 3, [fx('fee', -0.06)]),
      n('shopkeeper.shop_bell', 'Shop Bell', '🔔', 3, 1, 2, [fx('xp', 0.08)]),
      n('shopkeeper.display', 'Display Shelf', '🗄️', 5, -1, 1, [fx('stall_slots', 1)]),
      n('shopkeeper.golden_patter', 'Golden Patter', '✨', 6, 2, 1, [fx('fee', -0.08)], { secret: 'silver_tongue' }),
      n('shopkeeper.window_dressing', 'Window Dressing', '🪟', 7, 0, 2, [fx('fee', -0.04)], { requires: ['shopkeeper.patter'] }),
      n('shopkeeper.friendly_face', 'Friendly Face', '😊', 9, 1, 1, [fx('stat', 1, 'charisma')]),
      n('shopkeeper.shop_apprentice', 'Shop Apprentice', '🧑‍🏫', 11, 1, 2, [fx('mentor', 0.15)]),
      n('shopkeeper.bigger_display', 'Bigger Display', '🏬', 12, -1, 1, [fx('stall_slots', 1)], { requires: ['shopkeeper.display'] }),
      n('shopkeeper.quick_change', 'Quick Change', '🪙', 13, 0, 2, [fx('fee', -0.03)]),
      n('shopkeeper.good_name', 'Good Name', '📜', 16, 0, 2, [fx('fee', -0.04)]),
      n('shopkeeper.bargain_instinct', 'Bargain Instinct', '🧠', 18, -1, 2, [fx('xp', 0.08)]),
      cap('shopkeeper.beloved_shop', 'Beloved Shop', '💖', [fx('stall_slots', 3), fx('fee', -0.2)], { desc: 'Three more stalls, and fees slashed.' }),
    ],
  },

  porter: {
    label: 'Porter', icon: '🎒', kind: 'trade', primary: 'endurance', secondary: 'agility', skill: 'scouting',
    needs: null, base: {}, physical: true,
    desc: 'Carries goods to other towns, villages and Ironhaven. Anyone free can be sent, but porters carry more, walk faster and learn the roads.',
    tree: [
      n('porter.strong_back', 'Strong Back', '🎒', 2, 0, 3, [fx('carry', 0.1)]),
      n('porter.swift_feet', 'Swift Feet', '👟', 3, 1, 3, [fx('travel', 0.06)]),
      n('porter.village_friend', 'Village Friend', '🏘️', 5, -1, 1, [fx('npc_trust', 1)], { desc: 'Villages warm to you faster: +1 trust per trade.' }),
      n('porter.tireless_stride', 'Tireless Stride', '🏃', 6, -2, 1, [fx('travel', 0.1)], { secret: 'tireless' }),
      n('porter.road_bread', 'Road Bread', '🥖', 6, 0, 2, [fx('upkeep', -0.08)]),
      n('porter.packers_knot', 'Packer\'s Knot', '🪢', 8, 1, 2, [fx('carry', 0.05)], { requires: ['porter.strong_back'] }),
      n('porter.wayfinder', 'Wayfinder', '🧭', 10, -1, 2, [fx('travel', 0.05)], { requires: ['porter.swift_feet'] }),
      n('porter.lead_porter', 'Lead Porter', '🧑‍🏫', 12, 0, 2, [fx('mentor', 0.15)]),
      n('porter.road_wisdom', 'Road Wisdom', '📜', 14, 1, 2, [fx('xp', 0.1)]),
      n('porter.shortcuts', 'Shortcuts', '🗺️', 16, -1, 2, [fx('travel', 0.04)]),
      n('porter.sure_footed', 'Sure-Footed', '🦶', 18, 0, 2, [fx('injury', -4)]),
      cap('porter.courier', 'Courier of Kindlewood', '📯', [fx('travel', 0.2), fx('carry', 0.2)], { desc: '+20% speed and +20% carry.' }),
    ],
  },

  tavernkeep: {
    label: 'Tavernkeep', icon: '🍺', kind: 'service', primary: 'charisma', secondary: 'endurance', skill: null,
    needs: ['tavern'], base: {}, physical: false,
    desc: 'Runs the tavern: every tavernkeep lifts the settlement\'s mood. Needs a Tavern.',
    tree: [
      n('tavernkeep.warm_hearth', 'Warm Hearth', '🔥', 2, 0, 3, [fx('happiness', 1)]),
      n('tavernkeep.gossip', 'Gossip', '🗣️', 3, 1, 2, [fx('envoy', 0.05)], { desc: 'Hears everything; envoys know the way.' }),
      n('tavernkeep.regulars', 'Regulars', '🍺', 5, -1, 2, [fx('xp', 0.08)]),
      n('tavernkeep.born_host', 'Born Host\'s Welcome', '🤗', 6, 2, 1, [fx('happiness', 2)], { secret: 'born_host' }),
      n('tavernkeep.fireside_songs', 'Fireside Songs', '🎻', 6, 0, 2, [fx('happiness', 1)], { requires: ['tavernkeep.warm_hearth'] }),
      n('tavernkeep.tavern_tales', 'Tavern Tales', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('tavernkeep.good_cheer', 'Good Cheer', '😄', 10, -1, 1, [fx('stat', 1, 'charisma')]),
      n('tavernkeep.storyteller', 'Storyteller', '📖', 12, 0, 2, [fx('envoy', 0.05)]),
      n('tavernkeep.toast_master', 'Toast Master', '🥂', 14, 1, 2, [fx('happiness', 1)]),
      n('tavernkeep.old_friends', 'Old Friends', '👥', 16, -1, 2, [fx('xp', 0.1)]),
      n('tavernkeep.spiced_ale', 'Spiced Ale', '🍯', 18, 0, 2, [fx('happiness', 1)]),
      cap('tavernkeep.beloved_host', 'Beloved Host', '💛', [fx('happiness', 4)], { desc: 'The whole settlement +4 happiness.' }),
    ],
  },

  // ── Crafting (Phase 2): work a station slot, craft recipes ─────────────
  // Station slots = building level. Recipes live in the `recipes` table
  // (Dev Tools); nodes with `unlocks` open recipes with that unlock_node.
  blacksmith: {
    label: 'Blacksmith', icon: '⚒️', kind: 'crafting', primary: 'strength', secondary: 'endurance', skill: 'crafting',
    needs: ['smithy'], station: 'smithy', base: {}, physical: true,
    desc: 'Forges tools, weapons and armour at the Smithy. Each Smithy level adds a forge.',
    fork: [
      { key: 'weaponsmith', label: 'Weaponsmith', icon: '⚔️', desc: 'Blades and hammers with a bite: stronger weapons, and one day a blade you name yourself.' },
      { key: 'armorer', label: 'Armorer', icon: '🛡️', desc: 'Mail and plate that keep people alive — some pieces may even cheat death.' },
    ],
    tree: [
      n('blacksmith.strong_arm', 'Strong Arm', '💪', 2, 0, 3, [fx('craft_speed', 0.06)]),
      n('blacksmith.quench_lore', 'Quench Lore', '💧', 3, -1, 2, [fx('quality', 4)]),
      n('blacksmith.thrifty_smelting', 'Thrifty Smelting', '♻️', 4, 1, 2, [fx('refund', 0.1)], { desc: 'Sometimes the metal goes further than planned.' }),
      n('blacksmith.toolsmith', 'Toolsmith', '🛠️', 5, 0, 1, [], { unlocks: ['miners_pick', 'woodsmans_axe', 'farmers_hoe'], desc: 'Tools that make gatherers better at their jobs.', requires: ['blacksmith.strong_arm'] }),
      n('blacksmith.dragons_breath', 'Dragon\'s-Breath Bellows', '🔥', 6, -2, 1, [fx('quality', 8)], { secret: 'forge_born' }),
      n('blacksmith.bellows_rhythm', 'Bellows Rhythm', '🎵', 7, -1, 2, [fx('xp', 0.1)]),
      n('blacksmith.forge_master', 'Forge Master', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('blacksmith.iron_arms', 'Iron Arms', '🦾', 9, 0, 1, [fx('stat', 1, 'strength')]),
      ...spec('weaponsmith', [
        n('blacksmith.keen_edge', 'Keen Edge', '🗡️', 11, 0, 3, [fx('quality', 3)]),
        n('blacksmith.steel_mastery', 'Steel Mastery', '⚙️', 12, -1, 1, [], { unlocks: ['war_hammer', 'halberd'], desc: 'War hammers and halberds.' }),
        n('blacksmith.swift_forging', 'Swift Forging', '⚡', 14, 1, 2, [fx('craft_speed', 0.08)]),
        n('blacksmith.balanced_grip', 'Balanced Grip', '🤺', 16, 0, 2, [fx('quality', 3)], { requires: ['blacksmith.keen_edge'] }),
        n('blacksmith.weapon_lore', 'Weapon Lore', '📜', 18, -1, 2, [fx('xp', 0.1)]),
        cap('blacksmith.named_blade', 'Named Blade', '✨', [], { desc: 'Once a week, forge a weapon you name: Superior or better, with an extra edge. It bears the smith\'s mark forever.' }),
      ]),
      ...spec('armorer', [
        n('blacksmith.riveting', 'Riveting', '🔩', 11, 0, 3, [fx('quality', 3)]),
        n('blacksmith.layered_mail', 'Layered Mail', '⛓️', 12, 1, 1, [], { unlocks: ['scale_mail', 'plate_armour'], desc: 'Scale mail and plate.' }),
        n('blacksmith.fitted_armour', 'Fitted Armour', '📏', 14, -1, 2, [fx('craft_speed', 0.06)]),
        n('blacksmith.thick_plate', 'Thick Plate', '🧱', 16, 0, 2, [fx('quality', 3)], { requires: ['blacksmith.riveting'] }),
        n('blacksmith.armour_lore', 'Armour Lore', '📜', 18, 1, 2, [fx('xp', 0.1)]),
        cap('blacksmith.bulwark', 'Bulwark', '🛡️', [], { desc: 'Superior or better armour may be a Guardian: once, it saves its wearer from death and breaks instead.' }),
      ]),
    ],
  },

  jeweller: {
    label: 'Jeweller', icon: '💍', kind: 'crafting', primary: 'agility', secondary: 'intelligence', skill: 'crafting',
    needs: ['jeweller'], station: 'jeweller', base: {}, physical: false,
    desc: 'Makes rings, charms and pendants at the Jeweller. Each Jeweller level adds a bench.',
    fork: [
      { key: 'gemcutter', label: 'Gemcutter', icon: '💎', desc: 'Cuts raw gemstones into brilliance: pendants with the strongest charms.' },
      { key: 'goldsmith', label: 'Goldsmith', icon: '🪙', desc: 'Gold rings and signets that fetch fortunes — and make merchants sharper.' },
    ],
    tree: [
      n('jeweller.steady_bench', 'Steady Bench', '🪑', 2, 0, 3, [fx('quality', 3)]),
      n('jeweller.polishing', 'Polishing', '✨', 3, 1, 2, [fx('craft_speed', 0.07)]),
      n('jeweller.thrift', 'Every Scrap', '♻️', 4, -1, 2, [fx('refund', 0.1)]),
      n('jeweller.settings', 'Settings', '💠', 5, 0, 1, [], { unlocks: ['scouts_charm', 'anglers_charm'], desc: 'Charms for scouts and anglers.', requires: ['jeweller.steady_bench'] }),
      n('jeweller.true_hand', 'True Hand', '✋', 6, 2, 1, [fx('quality', 8)], { secret: 'steady_hands' }),
      n('jeweller.loupe_eye', 'Loupe Eye', '🔍', 7, -1, 2, [fx('xp', 0.1)]),
      n('jeweller.workshop_mentor', 'Bench Mentor', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('jeweller.fine_fingers', 'Fine Fingers', '🤏', 9, 0, 1, [fx('stat', 1, 'agility')]),
      ...spec('gemcutter', [
        n('jeweller.facets', 'Facets', '💎', 11, 0, 3, [fx('quality', 3)]),
        n('jeweller.pendants', 'Pendants', '📿', 12, -1, 1, [], { unlocks: ['gem_pendant'], desc: 'Gem pendants.' }),
        n('jeweller.clear_cut', 'Clear Cut', '🔪', 14, 1, 2, [fx('refund', 0.08)]),
        n('jeweller.star_cut', 'Star Cut', '🌟', 16, 0, 2, [fx('quality', 3)], { requires: ['jeweller.facets'] }),
        n('jeweller.gem_lore', 'Gem Lore', '📜', 18, -1, 2, [fx('craft_speed', 0.08)]),
        cap('jeweller.heart_of_the_mountain', 'Heart of the Mountain', '❤️‍🔥', [], { unlocks: ['heart_of_the_mountain'], desc: 'A legendary pendant recipe.' }),
      ]),
      ...spec('goldsmith', [
        n('jeweller.gold_leaf', 'Gold Leaf', '🪙', 11, 0, 3, [fx('quality', 3)]),
        n('jeweller.signets', 'Signets', '🔏', 12, 1, 1, [], { unlocks: ['signet_ring'], desc: 'Signet rings — merchants pay lower fees wearing one.' }),
        n('jeweller.quick_casting', 'Quick Casting', '⚡', 14, -1, 2, [fx('craft_speed', 0.08)]),
        n('jeweller.fine_alloys', 'Fine Alloys', '⚗️', 16, 0, 2, [fx('refund', 0.08)]),
        n('jeweller.court_jeweller', 'Court Jeweller', '👑', 18, 1, 2, [fx('xp', 0.1)]),
        cap('jeweller.midas_touch', 'Midas Touch', '✋', [], { desc: 'Everything they make is worth 15% more.' }),
      ]),
    ],
  },

  carpenter: {
    label: 'Carpenter', icon: '🪚', kind: 'crafting', primary: 'strength', secondary: 'agility', skill: 'crafting',
    needs: ['workshop'], station: 'workshop', base: {}, physical: true,
    desc: 'Works wood at the Workshop: rods, carts and bows. Each Workshop level adds a bench.',
    fork: [
      { key: 'bowyer', label: 'Bowyer', icon: '🏹', desc: 'Bows for your archers, up to the legendary heartwood longbow.' },
      { key: 'wainwright', label: 'Wainwright', icon: '🛞', desc: 'Pack frames and wagons that let porters and merchants carry far more.' },
    ],
    tree: [
      n('carpenter.joinery', 'Joinery', '🪵', 2, 0, 3, [fx('craft_speed', 0.06)]),
      n('carpenter.true_grain', 'True Grain', '🌳', 3, -1, 2, [fx('quality', 4)]),
      n('carpenter.offcuts', 'Offcuts', '♻️', 4, 1, 2, [fx('refund', 0.1)]),
      n('carpenter.handcarts', 'Handcarts', '🛒', 5, 0, 1, [], { unlocks: ['handcart'], desc: 'Handcarts for porters.', requires: ['carpenter.joinery'] }),
      n('carpenter.wood_whisper', 'Wood Whisper', '🍃', 6, -2, 1, [fx('quality', 8)], { secret: 'woodwise' }),
      n('carpenter.shop_songs', 'Shop Songs', '🎶', 7, -1, 2, [fx('xp', 0.1)]),
      n('carpenter.master_joiner', 'Master Joiner', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('carpenter.sawdust_arms', 'Sawdust Arms', '💪', 9, 0, 1, [fx('stat', 1, 'strength')]),
      ...spec('bowyer', [
        n('carpenter.bow_staves', 'Bow Staves', '🏹', 11, 0, 3, [fx('quality', 3)]),
        n('carpenter.longbows', 'Longbows', '🎯', 12, -1, 1, [], { unlocks: ['longbow'], desc: 'Longbows.' }),
        n('carpenter.fletching', 'Fletching', '🪶', 14, 1, 2, [fx('craft_speed', 0.08)]),
        n('carpenter.recurve', 'Recurve', '〰️', 16, 0, 2, [fx('quality', 3)], { requires: ['carpenter.bow_staves'] }),
        n('carpenter.bow_lore', 'Bow Lore', '📜', 18, -1, 2, [fx('xp', 0.1)]),
        cap('carpenter.heartwood_longbow', 'Heartwood Longbow', '🌲', [], { unlocks: ['heartwood_bow'], desc: 'The legendary heartwood bow.' }),
      ]),
      ...spec('wainwright', [
        n('carpenter.axles', 'Axles', '⚙️', 11, 0, 3, [fx('quality', 3)]),
        n('carpenter.pack_frames', 'Pack Frames', '🎒', 12, 1, 1, [], { unlocks: ['pack_frame', 'caravan_wagon'], desc: 'Pack frames and caravan wagons.' }),
        n('carpenter.spokes', 'Spokes', '🛞', 14, -1, 2, [fx('craft_speed', 0.08)]),
        n('carpenter.iron_tyres', 'Iron Tyres', '⭕', 16, 0, 2, [fx('refund', 0.08)]),
        n('carpenter.road_lore', 'Road Lore', '📜', 18, 1, 2, [fx('xp', 0.1)]),
        cap('carpenter.master_wheelwright', 'Master Wheelwright', '🏆', [fx('craft_speed', 0.3), fx('quality', 5)], { desc: 'Much faster, and finer, work.' }),
      ]),
    ],
  },

  smelter: {
    label: 'Smelter', icon: '🔥', kind: 'crafting', primary: 'endurance', secondary: 'strength', skill: 'crafting',
    needs: ['smelter'], station: 'smelter', base: {}, physical: true,
    desc: 'Runs the furnace at the Smelter: copper and tin into bronze, iron and coal into steel. Each Smelter level adds a furnace.',
    fork: [
      { key: 'bronzesmith', label: 'Bronzesmith', icon: '🔶', desc: 'Bell metal by the cartload: bigger bronze batches from the same ore.' },
      { key: 'steelmaker', label: 'Steelmaker', icon: '🔷', desc: 'Crucible steel: more steel from every load of iron and coal.' },
    ],
    tree: [
      n('smelter.steady_fire', 'Steady Fire', '🔥', 2, 0, 3, [fx('craft_speed', 0.06)]),
      n('smelter.ore_sorting', 'Ore Sorting', '🪨', 3, -1, 2, [fx('refund', 0.08)], { desc: 'Picks out the slag before it goes in.' }),
      n('smelter.slag_reader', 'Slag Reader', '👁️', 4, 1, 2, [fx('xp', 0.08)]),
      n('smelter.heat_haze', 'Heat Haze', '🥵', 5, 0, 2, [fx('upkeep', -0.06), fx('injury', -3)], { requires: ['smelter.steady_fire'] }),
      n('smelter.furnace_heart', 'Furnace Heart', '❤️‍🔥', 6, -2, 1, [fx('refund', 0.12), fx('craft_speed', 0.08)], { secret: 'forge_born' }),
      n('smelter.bellows_crew', 'Bellows Crew', '🌬️', 7, -1, 2, [fx('craft_speed', 0.06)]),
      n('smelter.fire_master', 'Fire Master', '🧑‍🏫', 8, 1, 2, [fx('mentor', 0.15)]),
      n('smelter.tough_hide', 'Tough Hide', '💪', 9, 0, 1, [fx('stat', 1, 'endurance')]),
      ...spec('bronzesmith', [
        n('smelter.bell_metal', 'Bell Metal', '🔔', 11, 0, 1, [], { unlocks: ['bronze_batch'], desc: 'Big bronze batches: more bronze per load of copper.' }),
        n('smelter.tin_sense', 'Tin Sense', '🔘', 12, -1, 2, [fx('refund', 0.06)]),
        n('smelter.quick_pour', 'Quick Pour', '⚡', 14, 1, 2, [fx('craft_speed', 0.08)]),
        n('smelter.bronze_lore', 'Bronze Lore', '📜', 16, 0, 2, [fx('xp', 0.1)], { requires: ['smelter.bell_metal'] }),
        n('smelter.clean_casts', 'Clean Casts', '🧊', 18, -1, 2, [fx('refund', 0.06)]),
        cap('smelter.bronze_age', 'Bronze Age', '🏺', [fx('refund', 0.15), fx('craft_speed', 0.15)], { desc: 'Bronze flows: much faster work, and often the ore goes further.' }),
      ]),
      ...spec('steelmaker', [
        n('smelter.crucibles', 'Crucibles', '🫕', 11, 0, 1, [], { unlocks: ['crucible_steel'], desc: 'Crucible steel: more steel per load of iron.' }),
        n('smelter.carbon_eye', 'Carbon Eye', '⚫', 12, 1, 2, [fx('refund', 0.06)]),
        n('smelter.blast_furnace', 'Blast Furnace', '🌋', 14, -1, 2, [fx('craft_speed', 0.08)]),
        n('smelter.steel_lore', 'Steel Lore', '📜', 16, 0, 2, [fx('xp', 0.1)], { requires: ['smelter.crucibles'] }),
        n('smelter.quench_tanks', 'Quench Tanks', '💧', 18, 1, 2, [fx('refund', 0.06)]),
        cap('smelter.wootz', 'Wootz', '🌀', [fx('refund', 0.15), fx('craft_speed', 0.15)], { desc: 'Steel like water: much faster work, and often the iron goes further.' }),
      ]),
    ],
  },

  // Old 'crafter' role — generic wealth from small goods. Retired by
  // crafting: no longer assignable; existing rows were moved to Forager.
  crafter: {
    label: 'Artisan', icon: '🧵', kind: 'crafting', primary: 'agility', secondary: 'intelligence', skill: 'crafting',
    needs: null, base: { wealth: 2 }, physical: false, assignedBy: 'retired',
    desc: 'Makes small goods to sell. (Becomes Blacksmith, Jeweller or Carpenter when crafting arrives.)',
    tree: [
      n('crafter.steady_hands', 'Steady Hands', '✋', 2, 0, 3, [fx('output', 0.06)]),
      n('crafter.trinkets', 'Trinkets', '🪆', 4, 1, 2, [fx('output', 0.05)]),
      n('crafter.workshop_tales', 'Workshop Tales', '📖', 5, -1, 2, [fx('xp', 0.08)]),
      n('crafter.master_and_pupil', 'Master and Pupil', '🧑‍🏫', 8, 0, 2, [fx('mentor', 0.15)]),
      n('crafter.nimble_fingers', 'Nimble Fingers', '🤏', 9, 1, 1, [fx('stat', 1, 'agility')]),
      n('crafter.fine_work', 'Fine Work', '💎', 12, 0, 3, [fx('output', 0.05)], { requires: ['crafter.steady_hands'] }),
      cap('crafter.renowned', 'Renowned Artisan', '🏅', [fx('output', 0.2)], { desc: '+20% output.' }),
    ],
  },
};

for (const [key, c] of Object.entries(CLASSES)) c.key = key;

// Roles that are not classes.
const NON_CLASS_ROLES = ['idle'];
// Classes a player can pick in the role dropdown (merchants/shopkeepers are
// assigned from the Market).
const ASSIGNABLE = Object.keys(CLASSES).filter(k => !CLASSES[k].assignedBy);
const VALID_ROLES = [...Object.keys(CLASSES), ...NON_CLASS_ROLES];

// The job a citizen falls back to when theirs has no building.
const FALLBACK_ROLE = 'forager';

const classOf = key => CLASSES[key] || null;
const specOf = (cls, key) => (cls && cls.fork ? cls.fork.find(f => f.key === key) || null : null);

// Does the settlement (building types it has) allow this class?
function needsMet(cls, buildingTypes) {
  if (!cls || !cls.needs) return true;
  const have = new Set(buildingTypes || []);
  return cls.needs.some(t => have.has(t));
}
// Role to give a new or displaced citizen: their own if allowed, else Forager.
function fallbackRole(role, buildingTypes) {
  const cls = classOf(role);
  if (!cls) return role;   // idle
  return needsMet(cls, buildingTypes) ? role : FALLBACK_ROLE;
}

module.exports = { CLASSES, VALID_ROLES, ASSIGNABLE, NON_CLASS_ROLES, FALLBACK_ROLE, classOf, specOf, needsMet, fallbackRole };
