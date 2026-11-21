// ══════════════════════════════════════════════════════════════════════════
//  tactics_foes — who a town's citizens fight on the board
//  (docs/TACTICS.md §5). Everyone in Kindlewood walks on two legs and wears
//  clothes, and so do those who mean it harm: outlaws, raiders, marsh folk
//  and the Withered. Nobody here is an animal on four legs (the owner's rule,
//  2026-11-21). Things out of stories are welcome: an ogre, a harpy, and
//  whatever else Phase 6 brings.
//
//  A foe is written for the board: how far it walks and jumps, how far each
//  thing it does reaches, its shape, how often. `pow` is the one number its
//  formulas read ("damage: pow*0.8 + 2"); a skull raises health and pow.
//
//    FOES            key → the foe
//    BANDS           key → { name, about }
//    OLD             a card-battle creature's id → the foe that stands in its
//                    place on the board (so a dungeon written for cards works)
//    foe(key)        the foe for a key, old or new, else null
//    list()          every foe, as the dungeon generator takes creatures
//    castFor(land, seed)   the foes of one dungeon: one band's, in the main
//    dropsOf(keys, seed)   what a won fight's foes left behind
//    SHOWCASE        band → a fight that shows what the band can do (Dev Tools)
//
//  Ranks are the generator's (lib/dungeon_gen.js): minion, regular, heavy,
//  elite, boss. Every land has each of them. Health and pow are first values
//  from scripts/tactics_sim.js, to be tuned by play.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const BANDS = {
  brigand:  { name: 'The Redtooth Brigands', about: 'Outlaws of the roads: patched leather, red neckerchiefs, and no manners.' },
  pack:     { name: 'The Night Pack',        about: 'Wolf raiders out of the deep wood, in hide and bone and blue war paint.' },
  crag:     { name: 'The Crag Reavers',      about: 'Harpies and storm crows of the high passes in black leather harness, and the hill ogres who club for them.' },
  mire:     { name: 'The Mire Folk',         about: 'Newts, toads and herons of the fen and the ford, in reed cloaks, with poison and fungus lanterns.' },
  withered: { name: 'The Withered',          about: 'Villagers the blight hollowed out. They still wear what they wore.' },
};

// An ability: reach min..max in steps (max 1 a melee blow, 0 oneself).
// to: 'foe' (default) | 'ally' | 'allies' (allies and itself) | 'self'.
// shape: 'single' (default) | 'line' | 'burst' (a tile and those beside it) | 'around' (everyone near it).
// cd: turns before it is ready again. look: what the screen draws (js/tactics.js PAINT).
const a = (key, name, icon, formula, x) => ({ key, name, icon, formula, ...(x || {}) });
const MELEE = { min: 1, max: 1 };

const FOES = {
  // ── The Redtooth Brigands ────────────────────────────────────────────────
  rat_cutpurse: { name: 'Rat Cutpurse', icon: '🐀', band: 'brigand', rank: 'minion', was: 'marsh_rat', lands: ['plains', 'marsh', 'river', 'ruins', 'forest'],
    flavour: 'Quick, thin, and already behind you.', hp: 22, pow: 5, agi: 9, move: 4, jump: 2, reward: 1, drops: [['ancient_coin', 0.10]],
    does: [a('shiv', 'Shiv', '🗡️', 'damage: pow*0.8 + 2', { ...MELEE, look: 'slash' })] },
  weasel_slinger: { name: 'Weasel Slinger', icon: '🦦', band: 'brigand', rank: 'minion', lands: ['plains', 'hills', 'forest', 'mountain'],
    flavour: 'Keeps its distance and a pouch of river stones.', hp: 22, pow: 6, agi: 10, move: 3, jump: 2, reward: 1, drops: [['iron_ore', 0.20]],
    does: [a('sling', 'Sling Stone', '🪨', 'damage: pow*0.7 + 2', { min: 2, max: 4, look: 'stone' }),
           a('scratch', 'Scratch', '💢', 'damage: pow*0.5 + 1', { ...MELEE, look: 'claw' })] },
  fox_footpad: { name: 'Fox Footpad', icon: '🦊', band: 'brigand', rank: 'regular', was: 'wild_fox', lands: ['forest', 'plains', 'hills'],
    flavour: 'A masked fox with a cutlass and a handful of sand.', hp: 30, pow: 7, agi: 11, move: 4, jump: 1, reward: 2, drops: [['ancient_coin', 0.15], ['wool', 0.20]],
    does: [a('cutlass', 'Cutlass', '⚔️', 'damage: pow*0.8 + 2', { ...MELEE, look: 'slash' }),
           a('sand', 'Pocket Sand', '🌫️', 'damage: 2\ndebuff weak: 2', { min: 1, max: 2, cd: 2, look: 'sand' })] },
  polecat_sawbones: { name: 'Polecat Sawbones', icon: '🦨', band: 'brigand', rank: 'regular', lands: ['plains', 'forest', 'hills', 'river'],
    flavour: 'The band\'s doctor, more or less. Patches up its friends; throws the rest at you.', hp: 28, pow: 6, agi: 7, move: 3, jump: 1, reward: 3, drops: [['blightbane_herb', 0.25]],
    does: [a('tonic', 'Stinging Tonic', '🧪', 'damage: pow*0.5 + 2', { min: 1, max: 3, look: 'vial' }),
           a('patch', 'Patch Up', '🩹', 'heal: pow*1.0 + 3', { to: 'ally', min: 1, max: 3, cd: 1, look: 'heal' })] },
  boar_bruiser: { name: 'Boar Bruiser', icon: '🐗', band: 'brigand', rank: 'heavy', was: 'thornback_boar', lands: ['forest', 'plains', 'hills'],
    flavour: 'Hired muscle in a spiked leather jerkin. Charges like a landslide.', hp: 46, pow: 9, agi: 6, move: 3, jump: 1, armour: 2, reward: 4, drops: [['iron_ore', 0.40, 1, 2]],
    does: [a('maul', 'Maul', '🔨', 'damage: pow*0.8 + 2', { ...MELEE, look: 'slash' }),
           a('charge', 'Tusk Charge', '💨', 'damage: pow*1.0 + 3\npush: 1', { ...MELEE, cd: 2, look: 'smash' }),
           a('brace', 'Brace', '🛡️', 'block: pow*1.0 + 3', { to: 'self', cd: 3, look: 'shield' })] },
  stoat_captain: { name: 'Stoat Captain', icon: '🦦', band: 'brigand', rank: 'elite', lands: ['plains', 'forest', 'hills'],
    flavour: 'A feathered hat, two blades, and a voice the whole band obeys.', hp: 62, pow: 9, agi: 10, move: 3, jump: 1, armour: 2, reward: 6, drops: [['ancient_coin', 0.50], ['gemstone', 0.12]],
    does: [a('twin', 'Twin Cut', '⚔️', 'damage: pow*0.9 + 3', { ...MELEE, look: 'slash' }),
           a('lowblow', 'Low Blow', '🦵', 'damage: pow*0.5 + 2\ndebuff vulnerable: 2', { ...MELEE, cd: 2, look: 'slash' }),
           a('rally', 'Rally', '📣', 'buff damage_bonus: 3', { to: 'allies', shape: 'around', radius: 2, cd: 3, look: 'cheer' })] },
  redtooth: { name: 'Redtooth, the Brigand King', icon: '👑', band: 'brigand', rank: 'boss', lands: ['plains'],
    flavour: 'A scarred stoat in a stolen coat, with a cutlass in each paw.', hp: 85, pow: 8, agi: 11, move: 4, jump: 1, armour: 2, reward: 10, drops: [['ancient_coin', 1, 1, 2], ['gemstone', 0.60]],
    does: [a('cutlasses', 'Twin Cutlasses', '⚔️', 'damage: pow*1.0 + 4', { ...MELEE, look: 'slash' }),
           a('knife', 'Throwing Knife', '🔪', 'damage: pow*0.6 + 3', { min: 2, max: 4, cd: 1, look: 'dart' }),
           a('gouge', 'Gouge', '💢', 'damage: pow*0.6 + 2\ndebuff weak: 2', { ...MELEE, cd: 2, look: 'claw' }),
           a('orders', 'Bark Orders', '📣', 'buff damage_bonus: 4', { to: 'allies', shape: 'around', radius: 3, cd: 3, look: 'cheer' })] },

  // ── The Night Pack ───────────────────────────────────────────────────────
  wolf_raider: { name: 'Wolf Raider', icon: '🐺', band: 'pack', rank: 'regular', was: 'night_wolf', lands: ['forest', 'plains', 'hills', 'mountain'],
    flavour: 'Hide armour, a hatchet, and a howl that puts heart into the pack.', hp: 34, pow: 8, agi: 10, move: 4, jump: 1, reward: 3, drops: [['iron_ore', 0.20]],
    does: [a('hatchet', 'Hatchet', '🪓', 'damage: pow*0.8 + 2', { ...MELEE, look: 'slash' }),
           a('howl', 'War Howl', '🌕', 'buff damage_bonus: 2', { to: 'allies', shape: 'around', radius: 2, cd: 3, look: 'wail' })] },
  wolf_bowhunter: { name: 'Wolf Bowhunter', icon: '🏹', band: 'pack', rank: 'regular', lands: ['forest', 'hills', 'mountain'],
    flavour: 'Hunts from the tree line, and aims for the legs.', hp: 28, pow: 7, agi: 10, move: 3, jump: 2, reward: 3, drops: [['timber_bundle', 0.25]],
    does: [a('shortbow', 'Shortbow', '🏹', 'damage: pow*0.7 + 2', { min: 2, max: 5, look: 'arrow' }),
           a('hobble', 'Hobbling Shot', '🦿', 'damage: pow*0.4 + 1\nslow: 2', { min: 2, max: 4, cd: 2, look: 'arrow' })] },
  pack_chieftain: { name: 'Pack Chieftain', icon: '🐺', band: 'pack', rank: 'elite', lands: ['forest', 'hills', 'mountain'],
    flavour: 'The biggest wolf, in the most bones, with the longest axe.', hp: 64, pow: 9, agi: 9, move: 4, jump: 1, armour: 2, reward: 6, drops: [['iron_ore', 0.60, 1, 2], ['gemstone', 0.12]],
    does: [a('greataxe', 'Greataxe', '🪓', 'damage: pow*1.0 + 3', { ...MELEE, look: 'slash' }),
           a('cleave', 'Cleave', '🌀', 'damage: pow*0.6 + 2', { shape: 'around', radius: 1, cd: 2, look: 'smash' }),
           a('howl', 'War Howl', '🌕', 'buff damage_bonus: 3', { to: 'allies', shape: 'around', radius: 2, cd: 3, look: 'wail' })] },
  greyfeather: { name: 'Old Greyfeather', icon: '🦉', band: 'pack', rank: 'boss', lands: ['forest'],
    flavour: 'A vast grey owl in a star-stitched cloak. The Pack hunts where it points.', hp: 82, pow: 8, agi: 11, move: 4, jump: 3, reward: 10, drops: [['ancient_heartwood', 0.70], ['ancient_blueprint', 0.08]],
    does: [a('talon', 'Talons', '🦶', 'damage: pow*0.9 + 3', { ...MELEE, look: 'claw' }),
           a('moonbolt', 'Moonbolt', '🌙', 'damage: pow*0.7 + 3', { min: 2, max: 5, look: 'hex' }),
           a('swoop', 'Silent Swoop', '🪶', 'damage: pow*0.5 + 2', { shape: 'around', radius: 2, cd: 3, look: 'wail' }),
           a('mantle', 'Mantle', '🛡️', 'block: pow*1.2 + 4', { to: 'self', cd: 3, look: 'shield' })] },

  // ── The Crag Reavers ─────────────────────────────────────────────────────
  mountain_harpy: { name: 'Mountain Harpy', icon: '🦅', band: 'crag', rank: 'regular', lands: ['mountain', 'hills'],
    flavour: 'A shriek on the wind, then talons. Leather harness, hooked knives on her heels, no patience for the ground.', hp: 32, pow: 7, agi: 12, move: 5, jump: 3, reward: 3, drops: [['gemstone', 0.06]],
    does: [a('rake', 'Talon Rake', '🦶', 'damage: pow*0.9 + 2', { ...MELEE, look: 'claw' }),
           a('shriek', 'Shriek', '📢', 'debuff weak: 2', { shape: 'around', radius: 2, cd: 3, look: 'wail' })] },
  crow_stormcaller: { name: 'Crow Stormcaller', icon: '🐦', band: 'crag', rank: 'regular', lands: ['mountain', 'hills', 'ruins'],
    flavour: 'A ragged black cloak, a copper rod, and the weather on a short leash.', hp: 28, pow: 7, agi: 8, move: 3, jump: 3, reward: 3, drops: [['iron_ore', 0.25]],
    does: [a('lash', 'Spark Lash', '⚡', 'damage: pow*0.7 + 3', { min: 1, max: 4, look: 'spark' }),
           a('gale', 'Gale', '🌬️', 'damage: pow*0.4 + 1\nslow: 2', { min: 1, max: 4, shape: 'line', cd: 2, look: 'gale' })] },
  hill_ogre: { name: 'Hill Ogre', icon: '👹', band: 'crag', rank: 'heavy', lands: ['hills', 'mountain', 'forest'],
    flavour: 'Big, slow, in a patched hide kilt, and very fond of its club.', hp: 54, pow: 10, agi: 3, move: 2, jump: 1, reward: 4, drops: [['ancient_coin', 0.15], ['gemstone', 0.08]],
    does: [a('club', 'Club', '🏏', 'damage: pow*0.9 + 2', { ...MELEE, look: 'smash' }),
           a('slam', 'Ground Slam', '💥', 'damage: pow*0.5\nstun: 1', { ...MELEE, cd: 2, look: 'quake' })] },
  stormcrow: { name: 'Stormcrow', icon: '🌩️', band: 'crag', rank: 'elite', lands: ['mountain', 'hills'],
    flavour: 'A great black bird in a mantle of feathers, crackling at the wingtips.', hp: 58, pow: 9, agi: 11, move: 4, jump: 3, reward: 6, drops: [['gemstone', 0.25]],
    does: [a('dive', 'Dive', '🦶', 'damage: pow*0.9 + 3', { ...MELEE, look: 'claw' }),
           a('lightning', 'Lightning', '⚡', 'damage: pow*0.7 + 3', { min: 2, max: 4, cd: 1, look: 'spark' }),
           a('thunder', 'Thunderclap', '🌩️', 'damage: pow*0.5 + 2\nslow: 1', { min: 1, max: 4, shape: 'burst', radius: 1, cd: 3, look: 'thunder' })] },
  storm_matriarch: { name: 'The Storm Matriarch', icon: '🦅', band: 'crag', rank: 'boss', lands: ['mountain'],
    flavour: 'A harpy queen in a storm-grey mantle. The wind arrives before she does.', hp: 80, pow: 8, agi: 12, move: 5, jump: 3, reward: 10, drops: [['gemstone', 0.80, 1, 2]],
    does: [a('dive', 'Dive', '🦶', 'damage: pow*1.0 + 4', { ...MELEE, look: 'claw' }),
           a('gale', 'Gale', '🌬️', 'damage: pow*0.5 + 2\nslow: 2', { min: 1, max: 5, shape: 'line', cd: 2, look: 'gale' }),
           a('shriek', 'Shriek', '📢', 'debuff weak: 3', { shape: 'around', radius: 2, cd: 3, look: 'wail' })] },
  grum: { name: 'Grum, the Ogre Chief', icon: '👹', band: 'crag', rank: 'boss', lands: ['hills'],
    flavour: 'A mountain of an ogre in a cart-wheel breastplate, with a tree for a club.', hp: 94, pow: 9, agi: 4, move: 3, jump: 1, armour: 2, reward: 10, drops: [['ancient_coin', 1, 1, 2], ['gemstone', 0.60]],
    does: [a('greatclub', 'Great Club', '🏏', 'damage: pow*1.0 + 4', { ...MELEE, look: 'smash' }),
           a('boulder', 'Boulder', '🪨', 'damage: pow*0.5 + 3', { min: 2, max: 4, shape: 'burst', radius: 1, cd: 2, look: 'boulder' }),
           a('roar', 'Roar', '📢', 'debuff weak: 2\ndebuff vulnerable: 2', { shape: 'around', radius: 2, cd: 4, look: 'wail' })] },

  // ── The Mire Folk ────────────────────────────────────────────────────────
  newt_darter: { name: 'Newt Darter', icon: '🦎', band: 'mire', rank: 'regular', was: 'bog_lurker', lands: ['marsh', 'river'],
    flavour: 'A reed cloak, a blowpipe, and darts dipped in something green.', hp: 32, pow: 7, agi: 8, move: 3, jump: 1, reward: 2, drops: [['blightbane_herb', 0.15]],
    does: [a('dart', 'Venom Dart', '🎯', 'damage: pow*0.3 + 1\npoison: 2', { min: 2, max: 4, cd: 1, look: 'dart' }),
           a('knife', 'Bone Knife', '🗡️', 'damage: pow*0.8 + 2', { ...MELEE, look: 'slash' })] },
  toad_sporecaller: { name: 'Toad Sporecaller', icon: '🐸', band: 'mire', rank: 'regular', was: 'fungal_toad', lands: ['marsh', 'forest', 'river'],
    flavour: 'Toadstools on its hat and in its pockets. Shakes its staff and the air goes bad.', hp: 40, pow: 8, agi: 4, move: 2, jump: 2, reward: 3, drops: [['rare_sap', 0.25]],
    does: [a('thump', 'Staff Thump', '🪵', 'damage: pow*0.8 + 2', { ...MELEE, look: 'smash' }),
           a('spores', 'Spore Cloud', '🍄', 'damage: pow*0.3 + 1\npoison: 2', { min: 1, max: 3, shape: 'burst', radius: 1, cd: 2, look: 'spores' })] },
  heron_lancer: { name: 'Heron Lancer', icon: '🦩', band: 'mire', rank: 'regular', was: 'river_pike', lands: ['river', 'marsh'],
    flavour: 'Tall, grey and patient, with a fishing spear twice its height.', hp: 30, pow: 8, agi: 9, move: 3, jump: 2, reward: 2, drops: [['luminous_scale', 0.08]],
    does: [a('thrust', 'Spear Thrust', '🔱', 'damage: pow*0.7 + 2', { min: 1, max: 2, shape: 'line', look: 'thrust' }),
           a('hook', 'Hook', '🪝', 'damage: pow*0.4\ndebuff vulnerable: 2', { min: 1, max: 2, cd: 2, look: 'thrust' })] },
  snapper_shellback: { name: 'Snapper Shellback', icon: '🐢', band: 'mire', rank: 'heavy', lands: ['river', 'marsh'],
    flavour: 'A snapping turtle in a studded shell. It can wait longer than you can.', hp: 48, pow: 9, agi: 3, move: 2, jump: 1, armour: 4, reward: 4, drops: [['iron_ore', 0.30], ['luminous_scale', 0.12]],
    does: [a('snap', 'Snap', '💢', 'damage: pow*0.9 + 2', { ...MELEE, look: 'claw' }),
           a('shell', 'Into the Shell', '🛡️', 'block: pow*1.5 + 4', { to: 'self', cd: 2, look: 'shield' })] },
  bog_witch: { name: 'Bog Witch', icon: '🧙', band: 'mire', rank: 'elite', lands: ['marsh', 'river'],
    flavour: 'A toad in a hat of woven reeds, with a hex lantern and a pot of something foul.', hp: 56, pow: 9, agi: 5, move: 3, jump: 1, reward: 6, drops: [['blightbane_herb', 0.60], ['luminous_scale', 0.20]],
    does: [a('hexbolt', 'Hex Bolt', '🔮', 'damage: pow*0.7 + 3', { min: 1, max: 4, look: 'hex' }),
           a('curse', 'Curse', '🕯️', 'debuff weak: 2\ndebuff vulnerable: 2', { min: 1, max: 4, shape: 'burst', radius: 1, cd: 3, look: 'curse' }),
           a('brew', 'Foul Brew', '🍵', 'heal: pow*1.5 + 4', { to: 'ally', min: 1, max: 3, cd: 2, look: 'heal' })] },
  old_snapjaw: { name: 'Old Snapjaw', icon: '🐢', band: 'mire', rank: 'boss', lands: ['river'],
    flavour: 'The toll-taker of the ford: a snapping turtle as old as the bridge, with an anchor on a chain.', hp: 88, pow: 8, agi: 4, move: 3, jump: 1, armour: 4, reward: 10, drops: [['luminous_scale', 0.80], ['ancient_coin', 0.60]],
    does: [a('snap', 'Snap', '💢', 'damage: pow*1.0 + 4', { ...MELEE, look: 'claw' }),
           a('thrash', 'Thrash', '🌀', 'damage: pow*0.6 + 2', { shape: 'around', radius: 1, cd: 2, look: 'smash' }),
           a('anchor', 'Anchor Chain', '⚓', 'damage: pow*0.5 + 2\nstun: 1', { min: 2, max: 3, cd: 4, look: 'boulder' })] },
  bog_mother: { name: 'The Bog Mother', icon: '🐸', band: 'mire', rank: 'boss', lands: ['marsh'],
    flavour: 'An enormous toad queen on a throne of roots, in a crown of toadstools.', hp: 96, pow: 8, agi: 3, move: 2, jump: 2, reward: 10, drops: [['rare_sap', 1, 1, 3], ['luminous_scale', 0.50]],
    does: [a('slam', 'Slam', '💥', 'damage: pow*0.9 + 4', { ...MELEE, look: 'smash' }),
           a('tongue', 'Tongue Lash', '👅', 'damage: pow*0.6 + 3', { min: 2, max: 3, cd: 1, look: 'thrust' }),
           a('storm', 'Spore Storm', '🍄', 'damage: pow*0.3 + 1\npoison: 3', { shape: 'around', radius: 2, cd: 3, look: 'spores' }),
           a('bloat', 'Bloat', '💗', 'heal: pow*2.0 + 6', { to: 'self', cd: 4, look: 'heal' })] },

  // ── The Withered ─────────────────────────────────────────────────────────
  hollow_thrall: { name: 'Hollow Thrall', icon: '🧟', band: 'withered', rank: 'regular', was: 'withered_husk', lands: ['ruins', 'marsh', 'forest'],
    flavour: 'Someone\'s neighbour, once. Grey fur, a torn apron, and a dull green light where the eyes were.', hp: 38, pow: 8, agi: 5, move: 2, jump: 1, reward: 3, drops: [['blightbane_herb', 0.15], ['ancient_coin', 0.10]],
    does: [a('claw', 'Claw', '💢', 'damage: pow*0.8 + 2', { ...MELEE, look: 'claw' }),
           a('rot', 'Rotting Touch', '☠️', 'debuff vulnerable: 3', { ...MELEE, cd: 2, look: 'curse' })] },
  hollow_bowman: { name: 'Hollow Bowman', icon: '💀', band: 'withered', rank: 'minion', lands: ['ruins', 'hills', 'forest', 'marsh'],
    flavour: 'Still stands its watch, in a rotted tabard, and still knows how to shoot.', hp: 22, pow: 6, agi: 8, move: 3, jump: 1, reward: 1, drops: [['ancient_coin', 0.08]],
    does: [a('bonearrow', 'Bone Arrow', '🏹', 'damage: pow*0.7 + 2', { min: 2, max: 5, look: 'arrow' })] },
  rot_shaman: { name: 'Rot Shaman', icon: '🧙', band: 'withered', rank: 'regular', was: 'rot_shaman', lands: ['ruins', 'marsh'],
    flavour: 'A hooded shrew in mouldering robes. Mutters over its kin and they stand back up.', hp: 30, pow: 6, agi: 6, move: 3, jump: 1, reward: 4, drops: [['blightbane_herb', 0.20], ['ancient_blueprint', 0.03]],
    does: [a('hex', 'Hex', '🔮', 'damage: pow*0.6 + 3', { min: 1, max: 4, look: 'hex' }),
           a('mend', 'Dark Mend', '💗', 'heal: pow*1.0 + 2', { to: 'ally', min: 1, max: 3, cd: 2, look: 'heal' })] },
  husk_brute: { name: 'Husk Brute', icon: '👹', band: 'withered', rank: 'heavy', lands: ['ruins', 'marsh'],
    flavour: 'A blacksmith, by the apron. Twice the size it was, and breathing mould.', hp: 50, pow: 9, agi: 3, move: 2, jump: 1, reward: 4, drops: [['iron_ore', 0.40], ['blightbane_herb', 0.20]],
    does: [a('smash', 'Smash', '🔨', 'damage: pow*0.9 + 3', { ...MELEE, look: 'smash' }),
           a('breath', 'Rot Breath', '🤢', 'damage: pow*0.3 + 1\npoison: 2', { min: 1, max: 2, shape: 'line', cd: 3, look: 'spores' })] },
  husk_knight: { name: 'Husk Knight', icon: '🛡️', band: 'withered', rank: 'elite', lands: ['ruins', 'marsh'],
    flavour: 'Rusted plate over grey fur, a notched cleaver, and an oath it cannot remember.', hp: 66, pow: 9, agi: 5, move: 3, jump: 1, armour: 4, reward: 6, drops: [['ancient_coin', 0.50], ['iron_ore', 0.50]],
    does: [a('cleaver', 'Cleaver', '🪓', 'damage: pow*1.0 + 3', { ...MELEE, look: 'slash' }),
           a('reap', 'Reap', '🌀', 'damage: pow*0.6 + 2', { shape: 'around', radius: 1, cd: 3, look: 'smash' }),
           a('rotshield', 'Shield of Rot', '🛡️', 'block: pow*1.2 + 4', { to: 'self', cd: 2, look: 'shield' })] },
  hollow_king: { name: 'The Hollow King', icon: '👑', band: 'withered', rank: 'boss', lands: ['ruins'],
    flavour: 'A Withered in a rusted crown and the rags of a royal cloak. Sorrowful more than cruel.', hp: 90, pow: 9, agi: 5, move: 3, jump: 1, armour: 4, reward: 10, drops: [['ancient_coin', 1, 2, 3], ['ancient_blueprint', 0.15]],
    does: [a('blade', 'Rusted Blade', '⚔️', 'damage: pow*1.0 + 4', { ...MELEE, look: 'slash' }),
           a('wail', 'Hollow Wail', '📢', 'damage: pow*0.4 + 1\ndebuff weak: 2', { shape: 'around', radius: 2, cd: 3, look: 'wail' }),
           a('crown', 'Crown of Rot', '🕯️', 'damage: pow*0.5 + 2\ndebuff vulnerable: 2', { min: 2, max: 4, shape: 'burst', radius: 1, cd: 3, look: 'curse' })] },
};
for (const k of Object.keys(FOES)) FOES[k].key = k;

// What a foe may leave behind: drops: [[item, chance, least, most]] (one of it
// unless said). What it carried, never a part of it: these are people in
// clothes, so nobody drops a hide.
// The drops of a fight that was won, from the battle's seed, so the same battle
// always leaves the same things. → [{ item, qty }], each item once.
function dropsOf(keys, seed, extra) {
  let a = ((Number(seed) >>> 0) ^ 0x51ed270b) >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [];
  (keys || []).forEach(k => {
    const f = foe(k), list = f ? (f.drops || []) : ((extra && extra[k]) || []);
    for (const d of list) {
      const [item, chance, least = 1, most = least] = Array.isArray(d) ? d : [d.item, d.chance, d.min, d.max];
      const hit = rnd() < Number(chance), n = Math.max(1, Math.round(Number(least) || 1)) + Math.floor(rnd() * (Math.max(0, (Number(most) || 1) - (Number(least) || 1)) + 1));
      if (!hit || !item) continue;
      const have = out.find(x => x.item === item);
      if (have) have.qty += n; else out.push({ item, qty: n });
    }
  });
  return out;
}

// A card creature's id → the foe in its place.
const OLD = {};
for (const f of Object.values(FOES)) if (f.was) OLD[f.was] = f.key;

const foe = key => FOES[key] || FOES[OLD[key]] || null;
// As the dungeon generator takes creatures: { id, name, max_hp, biomes, rank }.
const asCreature = f => ({ id: f.key, name: f.name, max_hp: f.hp, biomes: f.lands, rank: f.rank, archived: false });
const list = () => Object.values(FOES).map(asCreature);

const RANK_ORDER = ['minion', 'regular', 'heavy', 'elite', 'boss'];
// The foes of one dungeon. A dungeon belongs to a band: its foes are that
// band's who live in this land, and where the band has nobody of a rank
// (no heavy, say), whoever in the land does. Which band is the seed's choice,
// among those with at least two ordinary members here.
function castFor(land, seed) {
  const here = Object.values(FOES).filter(f => f.lands.includes(land));
  const bands = Object.keys(BANDS).filter(b => here.filter(f => f.band === b && (f.rank === 'minion' || f.rank === 'regular')).length >= 2).sort();
  if (!bands.length) return { band: null, creatures: here.map(asCreature) };
  const band = bands[Math.abs(Math.floor(Number(seed)) || 0) % bands.length];
  const own = here.filter(f => f.band === band);
  const cast = own.concat(...RANK_ORDER.filter(r => !own.some(f => f.rank === r)).map(r => here.filter(f => f.rank === r)));
  return { band, creatures: cast.map(asCreature) };
}

// A fight that shows what a band can do, for Dev Tools: someone who shoots,
// someone who heals or casts, and someone to stand in front.
const SHOWCASE = {
  brigand:  { first: ['fox_footpad', 'weasel_slinger', 'polecat_sawbones'], hard: ['boar_bruiser', 'fox_footpad', 'weasel_slinger', 'polecat_sawbones'], boss: ['stoat_captain', 'polecat_sawbones', 'redtooth'] },
  pack:     { first: ['wolf_raider', 'wolf_raider', 'wolf_bowhunter'], hard: ['pack_chieftain', 'wolf_raider', 'wolf_bowhunter'], boss: ['wolf_raider', 'wolf_bowhunter', 'greyfeather'] },
  crag:     { first: ['mountain_harpy', 'crow_stormcaller', 'weasel_slinger'], hard: ['hill_ogre', 'mountain_harpy', 'crow_stormcaller'], boss: ['mountain_harpy', 'crow_stormcaller', 'storm_matriarch'] },
  mire:     { first: ['heron_lancer', 'newt_darter', 'toad_sporecaller'], hard: ['snapper_shellback', 'newt_darter', 'toad_sporecaller', 'heron_lancer'], boss: ['newt_darter', 'bog_witch', 'bog_mother'] },
  withered: { first: ['hollow_thrall', 'hollow_bowman', 'rot_shaman'], hard: ['husk_brute', 'hollow_thrall', 'hollow_bowman', 'rot_shaman'], boss: ['husk_knight', 'rot_shaman', 'hollow_king'] },
};

module.exports = { FOES, BANDS, OLD, SHOWCASE, RANK_ORDER, foe, list, castFor, asCreature, dropsOf };
