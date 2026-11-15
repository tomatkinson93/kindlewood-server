#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
//  dungeon_balance_sim — numbers for docs/DUNGEON_CONTENT.md.
//
//  Plays whole dungeon runs on the REAL combat engine (lib/combat_engine,
//  card_engine, card_combat, card_formula) with a simple card-playing bot,
//  using the PROPOSED class cards and monsters below. Nothing here touches the
//  database or changes the game; the proposals are data in this file.
//
//    node scripts/dungeon_balance_sim.js cards      card values vs Strike
//    node scripts/dungeon_balance_sim.js monsters   monster threat table
//    node scripts/dungeon_balance_sim.js tiers [n]  clear rates per skull
//    node scripts/dungeon_balance_sim.js rules [n]  today's rules vs proposed
//    node scripts/dungeon_balance_sim.js quick [n]  one line per skull (for tuning;
//        SIM_TIERS='{"red":{"hp":1.5,"str":1.2}}' overrides the scaling)
//
//  Rules the sim assumes that the engine does not have yet (docs §2):
//    - weak / vulnerable wear off by 1 at the start of the bearer's turn
//    - Focus withers (once per battle)
//    - a class card is only drawn into the hand of a citizen who can play it
//    - charisma reaches the battle unit
//  `rules` shows what happens without the first two.
// ══════════════════════════════════════════════════════════════════════════
'use strict';
const _log = console.log; console.log = () => {};           // engine boot chatter
const E = require('../lib/combat_engine');
const REG = require('../lib/card_registry');
const FM = require('../lib/card_formula');
const DECK = require('../lib/card_engine');
console.log = _log;

// ── Cards ──────────────────────────────────────────────────────────────────
// [key, name, class|null, cost, type, target, formula, extra]
// The first block restates today's cards as formulas (same numbers) so one
// evaluator can read every card.
const C = (key, name, cls, cost, type, target, formula, x = {}) => ({
  card_key: key, name, cost, card_type: type, target, formula, hit: x.hit || 'choose',
  pierce_count: x.pierce || null, pierce_falloff: x.falloff != null ? x.falloff : 1, wither: !!x.wither,
  rarity: x.rarity || (cls ? 'uncommon' : 'common'), metadata: { requires_class: cls, school: x.school || null },
});
const BASE_CARDS = [
  C('strike', 'Strike', null, 1, 'attack', 'enemy', 'damage: strength*0.6 + combat*0.8 + 4'),
  C('defend', 'Defend', null, 1, 'defense', 'self', 'block: endurance*0.7 + combat*0.5 + 4'),
  C('quick_jab', 'Quick Jab', null, 0, 'attack', 'enemy', 'damage: agility*0.5 + combat*0.4 + 2'),
  C('rally', 'Rally', null, 1, 'support', 'ally', 'buff damage_bonus: charisma*0.4 + combat*0.2 + 2'),
  C('cleave', 'Cleave', null, 2, 'attack', 'all_enemies', 'damage: strength*0.5 + combat*0.4 + 3'),
  C('weaken', 'Weaken', null, 1, 'support', 'enemy', 'debuff weak: intelligence*0.3 + combat*0.2 + 2'),
  C('expose', 'Expose', null, 1, 'support', 'enemy', 'debuff vulnerable: agility*0.3 + combat*0.2 + 2'),
  C('focus', 'Focus', null, 0, 'support', 'none', 'energy: 2'),
  C('mend', 'Mend', null, 1, 'support', 'ally_or_self', 'heal: intelligence*0.6 + combat*0.2 + 4'),
  // unlockables (R4)
  C('venom_edge', 'Venom Edge', null, 1, 'attack', 'enemy', 'damage: agility*0.3 + combat*0.3 + 1\npoison: 3'),
  C('shield_bash', 'Shield Bash', null, 2, 'attack', 'enemy', 'damage: endurance*0.5 + combat*0.4 + 2\nstun: 1'),
  C('bulwark', 'Bulwark', null, 2, 'defense', 'all_allies', 'block: endurance*0.4 + combat*0.3 + 2'),
  C('second_wind', 'Second Wind', null, 1, 'support', 'self', 'heal: endurance*0.5 + combat*0.2 + 3\ndraw: 1'),
  C('arrow_rain', 'Arrow Rain', null, 2, 'attack', 'all_enemies', 'damage: agility*0.45 + combat*0.35 + 2'),
  C('hamstring', 'Hamstring', null, 1, 'attack', 'enemy', 'damage: agility*0.35 + combat*0.3 + 1\ndebuff weak: 2'),
  C('battle_cry', 'Battle Cry', null, 1, 'support', 'all_allies', 'buff damage_bonus: charisma*0.3 + combat*0.2 + 1'),
  C('smoke_bomb', 'Smoke Bomb', null, 1, 'defense', 'all_allies', 'block: intelligence*0.3 + combat*0.2 + 2'),
];
const CLASS_CARDS = [
  // Guard (strength / endurance) — the wall
  C('stand_fast', 'Stand Fast', 'guard', 1, 'defense', 'self', 'block: endurance*0.9 + combat*0.6 + 5'),
  C('guards_oath', "Guard's Oath", 'guard', 1, 'defense', 'ally', 'block: endurance*0.8 + combat*0.6 + 5'),
  C('hammer_blow', 'Hammer Blow', 'guard', 2, 'attack', 'enemy', 'damage: strength*1.2 + combat*1.2 + 8\ndebuff weak: 2', { hit: 'front' }),
  C('hold_the_line', 'Hold the Line', 'guard', 2, 'defense', 'all_allies', 'block: endurance*0.7 + combat*0.4 + 4', { wither: true, rarity: 'rare' }),
  // Archer (agility / strength) — picks the target
  C('aimed_shot', 'Aimed Shot', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.8 + combat*0.9 + 4'),
  C('piercing_arrow', 'Piercing Arrow', 'archer', 2, 'attack', 'enemy', 'damage: agility*0.8 + combat*0.8 + 4', { hit: 'pierce', falloff: 0.6 }),
  C('pin_down', 'Pin Down', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.4 + combat*0.4 + 2\nslow: 3\ndebuff weak: 3'),
  C('hail_of_arrows', 'Hail of Arrows', 'archer', 3, 'attack', 'all_enemies', 'damage: agility*0.8 + combat*0.8 + 5', { wither: true, rarity: 'rare' }),
  // Skirmisher (agility / intelligence) — poison, tricks, free cards
  C('backstab', 'Backstab', 'skirmisher', 1, 'attack', 'enemy', 'damage: agility*0.7 + combat*0.8 + 3\nif target_has vulnerable: damage: 5'),
  C('poisoned_blade', 'Poisoned Blade', 'skirmisher', 1, 'attack', 'enemy', 'damage: agility*0.4 + combat*0.4 + 2\npoison: intelligence*0.2 + 2'),
  C('slip_away', 'Slip Away', 'skirmisher', 0, 'defense', 'self', 'block: agility*0.4 + 2\ndraw: 1'),
  C('cut_purse', 'Cut Purse', 'skirmisher', 1, 'attack', 'enemy', 'damage: agility*0.6 + combat*0.6 + 3\nif lethal: gold: 15'),
  // Wildheart (strength / endurance) — hits hardest when hurt
  C('reckless_swing', 'Reckless Swing', 'wildheart', 1, 'attack', 'enemy', 'damage: strength*1.0 + combat*0.8 + 6\ndiscard: 1'),
  C('wounded_fury', 'Wounded Fury', 'wildheart', 1, 'attack', 'enemy', 'damage: strength*0.6 + combat*0.8 + 4\nif self_hp < 50: damage: strength*0.4 + 3'),
  C('sweeping_blow', 'Sweeping Blow', 'wildheart', 2, 'attack', 'all_enemies', 'damage: strength*0.55 + combat*0.4 + 3'),
  C('war_cry', 'War Cry', 'wildheart', 0, 'support', 'none', 'energy: 1\ndraw: 1', { wither: true }),
  // Wizard (intelligence / agility) — three schools
  C('firebolt', 'Firebolt', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.8 + combat*0.6 + 5', { school: 'ember' }),
  C('fireball', 'Fireball', 'wizard', 2, 'attack', 'all_enemies', 'damage: intelligence*0.65 + combat*0.4 + 3', { school: 'ember', rarity: 'rare' }),
  C('scorch', 'Scorch', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.4 + 3\npoison: intelligence*0.3 + 1', { school: 'ember' }),
  C('frost_lance', 'Frost Lance', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.6 + combat*0.5 + 3\nslow: 4\ndebuff weak: 2', { school: 'frost' }),
  C('ice_ward', 'Ice Ward', 'wizard', 1, 'defense', 'ally_or_self', 'block: intelligence*0.9 + combat*0.4 + 4', { school: 'frost' }),
  C('deep_freeze', 'Deep Freeze', 'wizard', 2, 'attack', 'enemy', 'damage: intelligence*1.0 + 3\nstun: 1', { school: 'frost', wither: true, rarity: 'rare' }),
  C('chain_lightning', 'Chain Lightning', 'wizard', 2, 'attack', 'enemy', 'damage: intelligence*0.8 + combat*0.5 + 4', { school: 'storm', hit: 'pierce', falloff: 0.7, rarity: 'rare' }),
  C('thunderclap', 'Thunderclap', 'wizard', 2, 'attack', 'all_enemies', 'damage: intelligence*0.4 + 2\nslow: 3\ndebuff weak: 2', { school: 'storm' }),
  // Hearthkeeper (intelligence / charisma) — the healer
  C('kindle', 'Kindle', 'hearthkeeper', 1, 'support', 'ally_or_self', 'heal: intelligence*0.7 + charisma*0.3 + 4', { school: 'hearth' }),
  C('hearthlight', 'Hearthlight', 'hearthkeeper', 2, 'support', 'all_allies', 'heal: intelligence*0.4 + charisma*0.2 + 2', { school: 'hearth' }),
  C('ember_ward', 'Ember Ward', 'hearthkeeper', 1, 'defense', 'ally_or_self', 'block: intelligence*0.6 + charisma*0.3 + 4\nbuff block_bonus: 2', { school: 'hearth' }),
  C('banish_blight', 'Banish the Blight', 'hearthkeeper', 1, 'attack', 'enemy', 'damage: intelligence*0.6 + combat*0.5 + 4\nif target_species withered: damage: intelligence*0.4 + 3', { school: 'hearth' }),
  C('rekindle', 'Rekindle', 'hearthkeeper', 2, 'support', 'ally_or_self', 'heal: intelligence*1.2 + charisma*0.5 + 8', { school: 'hearth', wither: true, rarity: 'rare' }),
  // Greenspeaker (intelligence / endurance) — thorns, bark and hexes
  C('thornlash', 'Thornlash', 'greenspeaker', 1, 'attack', 'enemy', 'damage: intelligence*0.5 + combat*0.5 + 3\npoison: 3', { school: 'growth' }),
  C('barkskin', 'Barkskin', 'greenspeaker', 1, 'defense', 'ally_or_self', 'block: intelligence*0.5 + endurance*0.4 + 3\nheal: 3', { school: 'growth' }),
  C('entangle', 'Entangle', 'greenspeaker', 2, 'support', 'enemy', 'stun: 1\ndebuff vulnerable: 4', { school: 'growth', rarity: 'rare' }),
  C('wild_growth', 'Wild Growth', 'greenspeaker', 2, 'support', 'all_allies', 'heal: intelligence*0.4 + 2\nblock: intelligence*0.3 + 2', { school: 'growth', wither: true, rarity: 'rare' }),
  C('wither_hex', 'Wither Hex', 'greenspeaker', 1, 'support', 'enemy', 'debuff weak: intelligence*0.3 + 2\ndebuff vulnerable: 3', { school: 'hex' }),
  // Minstrel (charisma / agility) — makes everyone else better
  C('marching_tune', 'Marching Tune', 'minstrel', 1, 'support', 'all_allies', 'buff damage_bonus: charisma*0.3 + 2', { school: 'song' }),
  C('lullaby', 'Lullaby', 'minstrel', 1, 'support', 'enemy', 'debuff weak: charisma*0.4 + 3\nslow: 3', { school: 'song' }),
  C('encore', 'Encore', 'minstrel', 1, 'support', 'none', 'draw: 2\nenergy: 1', { school: 'song' }),
  C('ballad_of_home', 'Ballad of Home', 'minstrel', 1, 'support', 'all_allies', 'heal: charisma*0.2 + 1\nblock: charisma*0.2 + 1', { school: 'song' }),
  C('rousing_chorus', 'Rousing Chorus', 'minstrel', 2, 'support', 'none', 'energy: 3\ndraw: 2', { school: 'song', wither: true, rarity: 'rare' }),
];
const ALL_CARDS = BASE_CARDS.concat(CLASS_CARDS);
const STARTER = ['strike', 'defend', 'quick_jab', 'rally', 'cleave', 'weaken', 'expose', 'focus', 'mend'];
const UNLOCKS = ['venom_edge', 'shield_bash', 'bulwark', 'second_wind', 'arrow_rain', 'hamstring', 'battle_cry', 'smoke_bomb'];

function loadCards(rules) {
  REG.loadRows(ALL_CARDS.map(c => (c.card_key === 'focus' ? { ...c, wither: !!rules.focusWithers } : c)));
}

// ── Classes ────────────────────────────────────────────────────────────────
const CLASSES = {
  guard:        { label: 'Guard',        primary: 'strength',     secondary: 'endurance',    exists: true },
  archer:       { label: 'Archer',       primary: 'agility',      secondary: 'strength',     exists: true },
  skirmisher:   { label: 'Skirmisher',   primary: 'agility',      secondary: 'intelligence' },
  wildheart:    { label: 'Wildheart',    primary: 'strength',     secondary: 'endurance' },
  wizard:       { label: 'Wizard',       primary: 'intelligence', secondary: 'agility' },
  hearthkeeper: { label: 'Hearthkeeper', primary: 'intelligence', secondary: 'charisma' },
  greenspeaker: { label: 'Greenspeaker', primary: 'intelligence', secondary: 'endurance' },
  minstrel:     { label: 'Minstrel',     primary: 'charisma',     secondary: 'agility' },
};
// How far along a citizen is. `fresh` is a villager with no training.
const LEVELS = {
  fresh:   { primary: 8,  secondary: 8,  other: 8, combat: 1, armour: 0 },
  novice:  { primary: 10, secondary: 9,  other: 8, combat: 2, armour: 2 },   // class level ~5, leather
  trained: { primary: 11, secondary: 10, other: 8, combat: 4, armour: 2 },   // class level ~10, leather
  veteran: { primary: 13, secondary: 11, other: 8, combat: 7, armour: 4 },   // class level 20, chainmail
};
let _cid = 0;
function citizen(cls, level) {
  const L = LEVELS[level], K = CLASSES[cls] || {};
  const stats = { strength: L.other, agility: L.other, endurance: L.other, intelligence: L.other, charisma: L.other };
  if (K.primary) stats[K.primary] = L.primary;
  if (K.secondary) stats[K.secondary] = L.secondary;
  return { id: ++_cid, name: (K.label || 'Villager') + _cid, role: cls || 'idle', stats, skills: { combat: L.combat }, armour: L.armour };
}
function unitOf(c) {
  const u = E.unitFromCitizen(c);
  u.charisma = c.stats.charisma;            // proposed fix: charisma reaches the unit
  u.block = 0; u.buffs = {};
  return u;
}

// ── Monsters ───────────────────────────────────────────────────────────────
// M(key, name, family, biomes, rank, hp, str, agi, end, combat, moves)
// rank: minion / regular / heavy / elite / boss.  Existing creatures keep
// their live stats; the three stock ones gain a move so block works on them.
const mv = (key, name, formula, target = 'enemy', hit = 'choose', intent = 'attack') => ({ key, name, formula, target, hit, intent });
const M = (key, name, family, biomes, rank, hp, str, agi, end, cmb, moves, x = {}) =>
  ({ key, name, family, biomes, rank, isNew: !x.existing, stats: { maxHp: hp, strength: str, agility: agi, endurance: end, combatSkill: cmb }, moves, move_mode: 'sequence', reward_weight: x.rw || 1 });
const OLD = { existing: true };
const MONSTERS = [
  // ── existing ──
  M('marsh_rat', 'Marsh Rat', 'beast', ['marsh', 'river', 'plains'], 'minion', 22, 5, 9, 4, 2, [mv('bite', 'Bite', 'damage: strength*1.0 + 1')], OLD),
  M('wild_fox', 'Wild Fox', 'beast', ['forest', 'plains', 'hills'], 'regular', 30, 7, 11, 5, 3, [mv('lunge', 'Lunge', 'damage: strength*1.0 + 2')], OLD),
  M('fungal_toad', 'Fungal Toad', 'beast', ['marsh', 'forest'], 'regular', 42, 8, 4, 9, 2, [mv('slam', 'Slam', 'damage: strength*1.0 + 1', 'enemy', 'front'), mv('spores', 'Spores', 'poison: 2', 'all_enemies', 'aoe', 'debuff')], OLD),
  M('bog_lurker', 'Bog Lurker', 'beast', ['marsh', 'river'], 'regular', 34, 7, 7, 6, 3, [mv('bite', 'Bite', 'damage: strength*0.8 + 2'), mv('venom', 'Venom Spit', 'damage: 2\npoison: 3', 'enemy', 'choose', 'debuff')], OLD),
  M('hill_ogre', 'Hill Ogre', 'beast', ['hills'], 'heavy', 60, 11, 3, 10, 3, [mv('club', 'Club', 'damage: strength*0.9 + 2', 'enemy', 'front'), mv('slam', 'Ground Slam', 'damage: strength*0.5\nstun: 1', 'enemy', 'front', 'special')], OLD),
  M('mountain_harpy', 'Mountain Harpy', 'beast', ['mountain', 'hills'], 'regular', 32, 7, 12, 4, 4, [mv('rake', 'Rake', 'damage: agility*0.6 + 2'), mv('shriek', 'Shriek', 'debuff weak: 3', 'all_enemies', 'aoe', 'debuff')], OLD),
  M('thornback_boar', 'Thornback Boar', 'beast', ['forest', 'plains'], 'regular', 44, 9, 6, 9, 3, [mv('bristle', 'Bristle', 'block: endurance*1 + 3', 'self', 'choose', 'block'), mv('charge', 'Charge', 'damage: strength*1.2 + 3', 'enemy', 'front')], OLD),
  M('river_pike', 'River Pike', 'beast', ['river', 'marsh'], 'regular', 28, 8, 9, 5, 3, [mv('snap', 'Snap', 'damage: strength*0.7 + 2'), mv('drag', 'Drag Under', 'damage: strength*0.4\ndebuff vulnerable: 2', 'enemy', 'choose', 'debuff')], OLD),
  M('withered_husk', 'Withered Husk', 'withered', ['ruins', 'marsh'], 'regular', 38, 8, 5, 8, 3, [mv('claw', 'Claw', 'damage: strength*0.8 + 2'), mv('rot', 'Rotting Touch', 'debuff vulnerable: 3', 'enemy', 'choose', 'debuff')], OLD),
  M('rot_shaman', 'Rot Shaman', 'withered', ['ruins'], 'regular', 30, 5, 6, 6, 4, [mv('hex', 'Hex', 'damage: intelligence*0.6 + 3'), mv('mend', 'Dark Mend', 'heal: 6', 'ally', 'choose', 'buff')], OLD),
  M('night_wolf', 'Night Wolf', 'beast', ['forest', 'plains', 'hills'], 'regular', 34, 8, 10, 6, 4, [mv('bite', 'Bite', 'damage: strength*0.8 + 2'), mv('howl', 'Pack Howl', 'damage: strength*0.4 + 1', 'all_enemies', 'aoe')], OLD),
  // ── new: minions ──
  M('gloom_bat', 'Gloom Bat', 'beast', ['mountain', 'ruins', 'forest', 'hills'], 'minion', 18, 4, 13, 3, 2, [mv('bite', 'Bite', 'damage: agility*0.4 + 2'), mv('screech', 'Screech', 'debuff weak: 2', 'all_enemies', 'aoe', 'debuff')]),
  M('barrow_beetle', 'Barrow Beetle', 'beast', ['hills', 'ruins', 'plains'], 'minion', 30, 5, 4, 10, 2, [mv('pinch', 'Pinch', 'damage: strength*0.8 + 2', 'enemy', 'front'), mv('shell', 'Shell Up', 'block: endurance*1 + 2', 'self', 'choose', 'block')]),
  M('mire_leech', 'Mire Leech', 'beast', ['marsh', 'river'], 'minion', 20, 4, 6, 5, 2, [mv('latch', 'Latch On', 'damage: 4\npoison: 2')]),
  M('bramble_sprite', 'Bramble Sprite', 'fey', ['forest', 'plains'], 'minion', 16, 3, 12, 3, 3, [mv('dart', 'Thorn Dart', 'damage: agility*0.5 + 1'), mv('tangle', 'Tangle', 'slow: 3\ndamage: 3', 'enemy', 'choose', 'debuff')]),
  M('scree_crab', 'Scree Crab', 'beast', ['mountain', 'river'], 'minion', 28, 6, 5, 9, 2, [mv('claw', 'Claw', 'damage: strength*0.9 + 1', 'enemy', 'front'), mv('hunker', 'Hunker', 'block: 10', 'self', 'choose', 'block')]),
  // ── new: regulars ──
  M('stoat_brigand', 'Stoat Brigand', 'brigand', ['plains', 'forest', 'hills'], 'regular', 40, 8, 9, 6, 3, [mv('cutlass', 'Cutlass', 'damage: strength*0.9 + 3', 'enemy', 'front'), mv('trick', 'Dirty Trick', 'damage: 4\ndebuff vulnerable: 2', 'enemy', 'choose', 'debuff')]),
  M('weasel_cutpurse', 'Weasel Cutpurse', 'brigand', ['plains', 'ruins', 'forest'], 'regular', 30, 6, 12, 4, 3, [mv('stab', 'Stab in the Back', 'damage: agility*0.6 + 2'), mv('smoke', 'Smoke', 'block: 8', 'self', 'choose', 'block')]),
  M('crow_sentinel', 'Crow Sentinel', 'brigand', ['hills', 'mountain', 'ruins'], 'regular', 34, 6, 11, 5, 3, [mv('peck', 'Peck', 'damage: agility*0.6 + 2'), mv('flock', 'Call the Flock', 'buff damage_bonus: 3', 'all_allies', 'choose', 'buff')]),
  M('adder', 'Adder', 'beast', ['plains', 'hills', 'marsh'], 'regular', 26, 5, 12, 4, 3, [mv('fangs', 'Fangs', 'damage: 5\npoison: 4')]),
  M('blight_hound', 'Blight Hound', 'withered', ['ruins', 'marsh', 'forest'], 'regular', 42, 9, 10, 6, 3, [mv('maul', 'Maul', 'damage: strength*1.0 + 2'), mv('howl', 'Blight Howl', 'debuff weak: 2', 'all_enemies', 'aoe', 'debuff')]),
  M('reed_snapper', 'Reed Snapper', 'beast', ['river', 'marsh'], 'regular', 50, 8, 3, 11, 2, [mv('bite', 'Bite', 'damage: strength*1.0 + 1', 'enemy', 'front'), mv('shell', 'Into the Shell', 'block: 14', 'self', 'choose', 'block')]),
  M('cave_spider', 'Cave Spider', 'beast', ['mountain', 'ruins', 'hills'], 'regular', 32, 6, 11, 5, 3, [mv('bite', 'Venom Bite', 'damage: 5\npoison: 3'), mv('web', 'Web', 'stun: 1', 'enemy', 'choose', 'special')]),
  // ── new: heavies ──
  M('husk_brute', 'Husk Brute', 'withered', ['ruins', 'marsh'], 'heavy', 70, 11, 4, 10, 3, [mv('smash', 'Smash', 'damage: strength*1.1 + 2', 'enemy', 'front'), mv('breath', 'Rot Breath', 'poison: 3', 'all_enemies', 'aoe', 'debuff')]),
  M('bog_hulk', 'Bog Hulk', 'beast', ['marsh', 'river'], 'heavy', 80, 10, 3, 12, 3, [mv('slam', 'Slam', 'damage: strength*1.1 + 2', 'enemy', 'front'), mv('slam2', 'Slam', 'damage: strength*1.1 + 2', 'enemy', 'front'), mv('grip', 'Mire Grip', 'damage: 5\nstun: 1', 'enemy', 'choose', 'special')]),
  M('stoat_bruiser', 'Stoat Bruiser', 'brigand', ['plains', 'forest', 'hills', 'mountain'], 'heavy', 66, 11, 6, 9, 4, [mv('maul', 'Maul', 'damage: strength*1.0 + 3', 'enemy', 'front'), mv('shove', 'Shove', 'damage: strength*0.6\npush: 1', 'enemy', 'front', 'special')]),
  // ── new: elites ──
  M('husk_knight', 'Husk Knight', 'withered', ['ruins', 'marsh'], 'elite', 130, 12, 6, 11, 6, [mv('cleaver', 'Cleaver', 'damage: strength*1.2 + combat + 3', 'enemy', 'front'), mv('shield', 'Shield of Rot', 'block: 20', 'self', 'choose', 'block'), mv('reap', 'Reap', 'damage: strength*0.7 + 2', 'all_enemies', 'aoe')], { rw: 5 }),
  M('stoat_captain', 'Stoat Captain', 'brigand', ['plains', 'forest', 'hills'], 'elite', 110, 11, 11, 8, 5, [mv('flurry', 'Flurry', 'damage: strength*0.8\ndamage: strength*0.8'), mv('rally', 'Rally the Band', 'buff damage_bonus: 4', 'all_allies', 'choose', 'buff'), mv('low', 'Low Blow', 'damage: 8\ndebuff vulnerable: 3', 'enemy', 'choose', 'debuff')], { rw: 5 }),
  M('bog_witch', 'Bog Witch', 'fey', ['marsh', 'river', 'forest'], 'elite', 100, 6, 8, 7, 5, [mv('bolt', 'Hex Bolt', 'damage: 14'), mv('curse', 'Curse', 'debuff weak: 3\ndebuff vulnerable: 3', 'all_enemies', 'aoe', 'debuff'), mv('brew', 'Foul Brew', 'heal: 15', 'ally', 'choose', 'buff')], { rw: 5 }),
  M('stormcrow', 'Stormcrow', 'beast', ['mountain', 'hills'], 'elite', 100, 8, 14, 6, 5, [mv('dive', 'Dive', 'damage: agility*1.2 + 4'), mv('gale', 'Gale', 'damage: 8\nslow: 3', 'all_enemies', 'aoe')], { rw: 5 }),
  // ── new: bosses (one per kind of land) ──
  M('old_greyfeather', 'Old Greyfeather', 'beast', ['forest'], 'boss', 240, 12, 12, 9, 6, [mv('talons', 'Talons', 'damage: strength*1.4 + 5'), mv('swoop', 'Silent Swoop', 'damage: strength*0.8 + 2', 'all_enemies', 'aoe'), mv('mantle', 'Mantle', 'block: 24', 'self', 'choose', 'block')], { rw: 8 }),
  M('redtooth', 'Redtooth, Brigand King', 'brigand', ['plains'], 'boss', 230, 12, 11, 9, 6, [mv('flurry', 'Twin Blades', 'damage: strength*0.9 + 1\ndamage: strength*0.9 + 1'), mv('orders', 'Bark Orders', 'buff damage_bonus: 5', 'all_allies', 'choose', 'buff'), mv('gouge', 'Gouge', 'damage: 10\ndebuff vulnerable: 4', 'enemy', 'choose', 'debuff')], { rw: 8 }),
  M('grum', 'Grum, the Ogre Chief', 'beast', ['hills'], 'boss', 280, 14, 3, 12, 5, [mv('club', 'Great Club', 'damage: strength*1.4 + 4', 'enemy', 'front'), mv('boulder', 'Boulder', 'damage: strength*0.8 + 1', 'all_enemies', 'aoe'), mv('roar', 'Roar', 'debuff weak: 3', 'all_enemies', 'aoe', 'debuff')], { rw: 8 }),
  M('storm_matriarch', 'The Storm Matriarch', 'beast', ['mountain'], 'boss', 220, 10, 14, 7, 6, [mv('dive', 'Dive', 'damage: agility*1.3 + 5'), mv('gale', 'Gale', 'damage: 9\nslow: 3', 'all_enemies', 'aoe'), mv('shriek', 'Shriek', 'debuff weak: 4', 'all_enemies', 'aoe', 'debuff')], { rw: 8 }),
  M('old_snapjaw', 'Old Snapjaw', 'beast', ['river'], 'boss', 260, 13, 8, 11, 5, [mv('snap', 'Snap', 'damage: strength*1.4 + 4', 'enemy', 'front'), mv('thrash', 'Thrash', 'damage: strength*0.8', 'all_enemies', 'aoe'), mv('drag', 'Drag Under', 'damage: 8\nstun: 1', 'enemy', 'choose', 'special')], { rw: 8 }),
  M('bog_mother', 'The Bog Mother', 'beast', ['marsh'], 'boss', 300, 11, 3, 13, 5, [mv('slam', 'Slam', 'damage: strength*1.4 + 4', 'enemy', 'front'), mv('spores', 'Spore Cloud', 'damage: 4\npoison: 4', 'all_enemies', 'aoe', 'debuff'), mv('bloat', 'Bloat', 'heal: 20\nblock: 10', 'self', 'choose', 'buff')], { rw: 8 }),
  M('hollow_king', 'The Hollow King', 'withered', ['ruins'], 'boss', 270, 13, 6, 11, 7, [mv('blade', 'Rusted Blade', 'damage: strength*1.3 + combat + 2', 'enemy', 'front'), mv('wail', 'Hollow Wail', 'damage: strength*0.6\ndebuff vulnerable: 3', 'all_enemies', 'aoe'), mv('crown', 'Crown of Rot', 'block: 18\nbuff damage_bonus: 5', 'self', 'choose', 'buff')], { rw: 8 }),
];
const MON = Object.fromEntries(MONSTERS.map(m => [m.key, m]));

// Skull tiers: how much every creature in the dungeon is scaled.
const TIERS = {
  green:  { hp: 0.50, str: 0.40 },
  yellow: { hp: 0.75, str: 0.60 },
  orange: { hp: 1.00, str: 0.80 },
  red:    { hp: 1.25, str: 1.00 },
  purple: { hp: 1.75, str: 1.40 },
};
if (process.env.SIM_TIERS) Object.assign(TIERS, JSON.parse(process.env.SIM_TIERS));
function installRoster(tier) {
  const t = TIERS[tier] || TIERS.green, live = E.ENEMIES();
  for (const k of Object.keys(live)) delete live[k];
  for (const m of MONSTERS) {
    live[m.key] = { key: m.key, name: m.name, icon: '?', stats: { ...m.stats,
      maxHp: Math.round(m.stats.maxHp * (1 + t.hp)), strength: Math.max(1, Math.round(m.stats.strength * (1 + t.str))),
      agility: Math.max(1, Math.round(m.stats.agility * (1 + t.str / 2))) },
      reward_weight: m.reward_weight, moves: m.moves.map(x => ({ ...x })), move_mode: m.move_mode, drops: [] };
  }
}

// ── Monster threat ─────────────────────────────────────────────────────────
// Damage a creature deals per turn over its move cycle to a party of three
// (so area moves count), plus a value for what its other moves do.
function moveThreat(m, mon, targets = 3) {
  const u = { strength: mon.stats.strength, agility: mon.stats.agility, endurance: mon.stats.endurance, intelligence: 5, combatSkill: mon.stats.combatSkill };
  const n = (m.target === 'all_enemies' || m.hit === 'aoe') ? targets : 1;
  let v = 0;
  for (const op of FM.parseFormula(m.formula).ops) {
    const a = Math.round(op.eval(u));
    if (op.verb === 'damage') v += a * n;
    else if (op.verb === 'poison') v += (a * (a + 1) / 2) * n * 0.8;
    else if (op.verb === 'stun') v += 12 * a;
    else if (op.verb === 'debuff') v += a * 2 * n;
    else if (op.verb === 'buff') v += a * 2;
    else if (op.verb === 'block') v += a * 0.5;
    else if (op.verb === 'heal') v += a * 0.7;
    else if (op.verb === 'slow' || op.verb === 'push') v += 2;
  }
  return v;
}
function threatOf(mon) {
  const per = mon.moves.reduce((s, m) => s + moveThreat(m, mon), 0) / mon.moves.length;
  return { perTurn: per, tp: Math.sqrt(mon.stats.maxHp * per) };
}
const crOf = mon => Math.max(0.5, Math.round(threatOf(mon).tp / 10 * 2) / 2);

// ── The bot ────────────────────────────────────────────────────────────────
const alive = u => u && u.hp > 0 && !(u.flags && u.flags.downed);
const side = (s, sd) => s.units.filter(u => u.side === sd && alive(u)).sort((a, b) => (a.pos || 99) - (b.pos || 99));
const parsed = {};
const opsOf = card => parsed[card.key] || (parsed[card.key] = FM.parseFormula(card.formula || '').ops);
const canUse = (card, actor) => { const rc = card.metadata && card.metadata.requires_class; return !rc || rc === actor.role; };

function incomingFor(s, u) {                    // damage the enemy line is about to aim at this unit
  let t = 0;
  for (const e of side(s, 'enemy')) {
    if (e.buffs && e.buffs.stun > 0) continue;
    const m = e._intent; if (!m) continue;
    const aoe = m.target === 'all_enemies' || m.hit === 'aoe';
    const front = side(s, 'player')[0];
    const hitsMe = aoe || ((m.hit === 'front' || m.hit === 'pierce') ? front === u : side(s, 'player')[0] === u || s.units.filter(x => x.side === 'player' && alive(x))[0] === u);
    if (!hitsMe) continue;
    for (const op of FM.parseFormula(m.formula).ops) if (op.verb === 'damage') t += Math.max(1, Math.round(op.eval(e)) - ((e.buffs && e.buffs.weak) || 0));
  }
  return t;
}
function cond(op, s, actor, target, amount) {
  if (!op.predicate) return true;
  const foes = side(s, 'enemy');
  try {
    return !!op.predicate({ actor, target, state: s, frontmostEnemy: foes[0] || null, isFront: () => side(s, actor.side)[0] === actor,
      isBack: () => { const l = side(s, actor.side); return l[l.length - 1] === actor; },
      handCount: s.deck.hand.length, drawCount: s.deck.drawPile.length, discardCount: s.deck.discardPile.length, energy: s.deck.energy, energySpent: 0,
      isLethal: () => target && target.hp - Math.max(1, amount) <= 0, adjacent: () => false });
  } catch (e) { return false; }
}
// What playing `card` on `target` is worth right now (rough points ≈ HP).
function cardValue(s, actor, card, target) {
  const foes = side(s, 'enemy'), mates = side(s, 'player');
  const mode = card.target;
  let targets;
  if (mode === 'all_enemies') targets = foes.map(f => [f, 1]);
  else if (mode === 'all_allies') targets = mates.map(f => [f, 1]);
  else if (mode === 'enemy' && card.hit === 'pierce') targets = foes.map((f, i) => [f, Math.pow(card.pierce_falloff != null ? card.pierce_falloff : 1, i)]);
  else if (mode === 'none') targets = [[actor, 1]];
  else targets = [[target || actor, 1]];
  let v = 0;
  for (const [t, scale] of targets) {
    let hp = t.hp, blk = t.block || 0;
    for (const op of opsOf(card)) {
      const a = Math.round(op.eval(actor));
      if (!cond(op, s, actor, t, a)) continue;
      const pierceOnly = scale !== 1 && op.verb !== 'damage';
      if (pierceOnly) continue;
      switch (op.verb) {
        case 'damage': {
          if (t.side === actor.side) break;
          let d = Math.max(1, Math.round(a * scale)) + ((actor.buffs && actor.buffs.damage_bonus) || 0) - ((actor.buffs && actor.buffs.weak) || 0) + ((t.buffs && t.buffs.vulnerable) || 0);
          d = Math.max(1, d); const ab = Math.min(blk, d); blk -= ab; d -= ab;
          const dealt = Math.min(hp, d); hp -= dealt; v += dealt + ab * 0.5;
          if (hp <= 0) v += 8 + threatOf(MON[t.enemy_key] || { stats: { maxHp: 30 }, moves: [mv('x', 'x', 'damage: 8')] }).perTurn;
          break;
        }
        case 'block': {
          const who = t.side === actor.side ? t : actor;
          const need = Math.max(0, incomingFor(s, who) - (who.block || 0));
          v += Math.min(a, need) * 1.0 + Math.max(0, a - need) * 0.15; break;
        }
        case 'heal': { const who = t.side === actor.side ? t : actor; v += Math.min(a, who.maxHp - who.hp) * 1.1; break; }
        case 'poison': if (t.side !== actor.side && hp > 0) v += Math.min(hp, a * (a + 1) / 2) * 0.8; break;
        case 'stun': if (t.side !== actor.side && hp > 0 && !(t.buffs && t.buffs.stun > 0)) v += Math.min(30, threatOf(MON[t.enemy_key]).perTurn) * a; break;
        case 'debuff':
          if (t.side === actor.side || hp <= 0) break;
          if (op.param === 'weak') v += Math.min(a, 8) * 2;
          else if (op.param === 'vulnerable') v += a * (hp > 30 ? 2.5 : 1);
          break;
        case 'buff': v += a * (op.param === 'block_bonus' ? 1.5 : 0.8); break;
        case 'energy': if (mode === 'none' || t === actor) v += a * 9; break;
        case 'draw': v += a * 4; break;
        case 'discard': v -= a * 3; break;
        default: v += 1;
      }
    }
    if (mode === 'none') break;
  }
  return v;
}
function bestPlay(s, actor) {
  const d = s.deck; let best = null;
  for (let i = 0; i < d.hand.length; i++) {
    const card = REG.getCard(d.hand[i]);
    if (!card || card.cost > d.energy || !canUse(card, actor)) continue;
    let cands;
    if (card.target === 'enemy') { const foes = side(s, 'enemy'); cands = (card.hit === 'front' || card.hit === 'pierce') ? foes.slice(0, 1) : foes; }
    else if (card.target === 'ally') { cands = side(s, 'player').filter(u => u !== actor); if (!cands.length) cands = [actor]; }
    else if (card.target === 'ally_or_self') cands = side(s, 'player');
    else cands = [null];
    for (const t of cands) {
      const v = cardValue(s, actor, card, t);
      const score = v / Math.max(card.cost, 0.4);
      if (v > 1.5 && (!best || score > best.score)) best = { i, t, score };
    }
  }
  return best;
}
// The proposed draw rule: a class card nobody at this turn can play is set
// aside and another card is drawn in its place.
function fixHand(s, actor) {
  const d = s.deck; let tries = 0;
  for (let i = d.hand.length - 1; i >= 0 && tries < 12; i--) {
    const card = REG.getCard(d.hand[i]);
    if (card && !canUse(card, actor)) {
      d.discardPile.unshift(d.hand.splice(i, 1)[0]);
      if (d.drawPile.length) { DECK.drawCards(s, 1); tries++; }
    }
  }
}

function fight(party, enemyKeys, deck, seed, rules) {
  const units = party.filter(p => p.hp > 0).map(p => { const u = unitOf(p.c); u.hp = Math.min(u.maxHp, p.hp); return u; });
  const s = E.createBattle({ players: units, enemies: enemyKeys, seed, deck });
  for (const u of s.units) if (u.side === 'enemy') u.species = (MON[u.enemy_key] || {}).family;
  let guard = 0, turns = 0;
  while (s.status === 'active' && guard++ < 600) {
    const cur = E.currentUnit(s); if (!cur) break;
    if (rules.decay && cur.buffs) for (const k of ['weak', 'vulnerable']) if (cur.buffs[k] > 0) cur.buffs[k] -= 1;
    if (cur.side === 'enemy') { if (!E.enemyAct(s)) break; continue; }
    turns++;
    if (rules.classDraw) fixHand(s, cur);
    let plays = 0, p;
    while (s.status === 'active' && plays++ < 12 && (p = bestPlay(s, cur))) if (!E.playCard(s, p.i, p.t ? p.t.id : null)) break;
    if (s.status === 'active') E.endTurn(s);
  }
  for (const p of party) { const u = s.units.find(x => x.citizen_id === p.c.id); if (u) { p.hp = Math.max(0, u.hp); if (u.hp <= 0) p.wentDown = true; } }
  return { win: s.status === 'victory', rounds: s.round, turns };
}

// ── Draft ──────────────────────────────────────────────────────────────────
function rng32(seed) { return E.makeSeededRng(seed); }
function draft(party, pool, size, rnd, rules) {
  const classes = [...new Set(party.map(p => p.c.role))].filter(k => CLASSES[k]);
  const general = pool.filter(k => !(REG.getCard(k).metadata || {}).requires_class);
  const classPool = pool.filter(k => classes.includes((REG.getCard(k).metadata || {}).requires_class));
  const rate = key => {                       // a card's worth to this party, per energy
    const card = REG.getCard(key), rc = card.metadata && card.metadata.requires_class;
    const who = party.map(p => unitOf(p.c)).find(u => !rc || u.role === rc) || unitOf(party[0].c);
    const dummy = { side: 'enemy', hp: 60, maxHp: 60, block: 0, buffs: {}, enemy_key: 'wild_fox', flags: {} };
    const hurt = { ...who, hp: who.maxHp * 0.6 };
    const fake = { units: [hurt, dummy, { ...dummy }], deck: { hand: [], drawPile: [], discardPile: [], energy: 3 } };
    dummy._intent = MON.wild_fox.moves[0];
    const mode = card.target;
    const t = (mode === 'enemy') ? dummy : hurt;
    let v = cardValue(fake, hurt, card, t) / Math.max(card.cost, 0.6);
    if (rc) v *= party.filter(p => p.c.role === rc).length / party.length * 0.5 + 0.5;   // only some turns can play it
    return v;
  };
  const deck = {}; let n = 0; const count = type => Object.keys(deck).reduce((s, k) => s + (REG.getCard(k).type === type ? deck[k] : 0), 0);
  let reroll = 1;
  for (let pick = 0; pick < size; pick++) {
    const offer = () => {
      const o = [];
      const take = from => { const c = from.filter(k => !o.includes(k)); if (c.length) o.push(c[Math.floor(rnd() * c.length)]); };
      if (pick === 0) take(general.filter(k => REG.getCard(k).type === 'attack'));
      if (pick === 1) take(general.filter(k => REG.getCard(k).type === 'defense'));
      if (rules.classOffers && classPool.length && o.length < 3) take(classPool);
      const rest = rules.classOffers ? general : general.concat(classPool);
      while (o.length < 3 && rest.filter(k => !o.includes(k)).length) take(rest);
      return o;
    };
    let o = offer();
    const want = k => {
      const card = REG.getCard(k); let v = rate(k);
      if (card.type === 'attack' && count('attack') < Math.ceil(size * 0.45)) v *= 1.6;
      if (card.type === 'defense' && count('defense') < Math.ceil(size * 0.25)) v *= 1.4;
      if ((deck[k] || 0) >= 3) v *= 0.6;
      if (card.wither && (deck[k] || 0) >= 1) v *= 0.5;
      return v;
    };
    if (reroll && Math.max(...o.map(want)) < 6) { reroll--; o = offer(); }
    const k = o.slice().sort((a, b) => want(b) - want(a))[0];
    deck[k] = (deck[k] || 0) + 1; n++;
  }
  return deck;
}

// ── A dungeon run ──────────────────────────────────────────────────────────
const byRank = (terrain, rank) => MONSTERS.filter(m => m.rank === rank && m.biomes.includes(terrain));
function encounter(terrain, shape, rnd) {
  // shape e.g. ['minion','regular'] or ['boss','minion']
  return shape.map(rank => { const c = byRank(terrain, rank); const pool = c.length ? c : MONSTERS.filter(m => m.rank === rank); return pool[Math.floor(rnd() * pool.length)].key; });
}
// Plans: what a typical route holds, in order. R = rest, L = landing (rest between floors).
const PLANS = {
  green:  { party: ['fresh', 4], deck: 12, rooms: [['regular', 'regular', 'minion'], 'R', ['heavy', 'regular', 'minion'], ['boss', 'regular']] },
  yellow: { party: ['novice', 4], deck: 12, rooms: [['regular', 'regular', 'regular'], ['heavy', 'regular', 'regular'], 'R', ['heavy', 'heavy', 'minion'], ['boss', 'regular', 'minion']] },
  orange: { party: ['trained', 4], deck: 14, rooms: [['regular', 'regular', 'regular', 'minion'], ['heavy', 'regular', 'regular'], 'R', ['heavy', 'heavy', 'regular'], 'L',
            ['heavy', 'regular', 'regular', 'minion'], ['elite', 'regular', 'regular'], 'R', ['boss', 'regular', 'minion']] },
  red:    { party: ['trained', 4], deck: 14, rooms: [['regular', 'regular', 'regular'], ['heavy', 'regular', 'minion'], 'R', ['elite', 'regular'], 'L',
            ['heavy', 'heavy', 'minion'], ['regular', 'regular', 'regular', 'minion'], 'R', ['heavy', 'regular', 'regular'], ['boss', 'regular', 'minion']] },
  purple: { party: ['veteran', 4], deck: 16, rooms: [['regular', 'regular', 'regular'], ['heavy', 'regular', 'regular'], 'R', ['elite', 'regular'], 'L',
            ['heavy', 'heavy', 'regular'], ['regular', 'regular', 'regular', 'minion'], 'R', ['elite', 'regular', 'minion'], 'L',
            ['heavy', 'heavy', 'minion'], ['heavy', 'regular', 'regular'], 'R', ['boss', 'regular', 'regular']] },
};
const REST = 0.30;          // share of max health a rest gives back (and stands the downed up with)
const DEFAULT_RULES = { decay: true, focusWithers: true, classDraw: true, classOffers: true };

function run(tier, opts, seed) {
  const plan = PLANS[tier], rnd = rng32(seed), rules = opts.rules || DEFAULT_RULES;
  const level = opts.level || plan.party[0], size = opts.size || plan.party[1];
  const classes = opts.classes || [];
  const party = [];
  for (let i = 0; i < size; i++) { const c = citizen(classes[i] || null, level); party.push({ c, hp: E.statsFromCitizen(c).maxHp, max: E.statsFromCitizen(c).maxHp }); }
  const owned = STARTER.concat(opts.unlocks ? UNLOCKS : []).concat(CLASS_CARDS.filter(c => classes.includes(c.metadata.requires_class)).map(c => c.card_key));
  const deck = opts.homeDeck || draft(party, owned, plan.deck, rnd, rules);
  const terrain = opts.terrain || ['forest', 'plains', 'hills', 'mountain', 'river', 'marsh', 'ruins'][Math.floor(rnd() * 7)];
  installRoster(tier);
  const out = { cleared: false, fights: 0, turns: 0, rounds: 0, lost: [], reached: 0 };
  let i = 0;
  for (const room of plan.rooms) {
    i++;
    if (room === 'R' || room === 'L') { for (const p of party) p.hp = Math.min(p.max, Math.max(p.hp, 0) + Math.round(p.max * REST)); continue; }
    const before = party.reduce((s, p) => s + p.hp, 0);
    const r = fight(party, encounter(terrain, room, rnd), deck, Math.floor(rnd() * 2e9) + 1, rules);
    out.fights++; out.turns += r.turns; out.rounds += r.rounds;
    out.lost.push((before - party.reduce((s, p) => s + p.hp, 0)) / party.reduce((s, p) => s + p.max, 0));
    if (!r.win) { out.reached = i; out.down = party.filter(p => p.wentDown).length; return out; }
  }
  out.cleared = true; out.reached = i; out.down = party.filter(p => p.wentDown).length; out.hpLeft = party.reduce((s, p) => s + p.hp, 0) / party.reduce((s, p) => s + p.max, 0);
  return out;
}
function trial(tier, opts, n) {
  let clear = 0, turns = 0, fights = 0, down = 0, left = 0, lost = 0, lostN = 0;
  for (let k = 0; k < n; k++) {
    const r = run(tier, opts, 1000 + k * 7919);
    if (r.cleared) { clear++; left += r.hpLeft; }
    turns += r.turns; fights += r.fights; down += r.down || 0;
    for (const l of r.lost) { lost += l; lostN++; }
  }
  return { clear: clear / n, turnsPerRun: turns / n, turnsPerFight: turns / fights, down: down / n, hpLeft: clear ? left / clear : 0, lossPerFight: lost / lostN };
}

// ── Reports ────────────────────────────────────────────────────────────────
const pct = x => (x * 100).toFixed(0) + '%';
const pad = (s, n) => String(s).padEnd(n);
function reportCards() {
  loadCards(DEFAULT_RULES);
  console.log('Card values for a TRAINED citizen of the card\'s class (primary 11, secondary 10, others 8, combat 4).');
  console.log('Points ≈ health: damage dealt, block that stops a 14-damage hit, healing on a wounded ally, etc.\n');
  console.log(pad('card', 20) + pad('class', 14) + pad('cost', 5) + pad('effect at these stats', 44) + pad('pts', 6) + pad('pts/energy', 11) + 'vs Strike');
  let strikeRef = null;
  for (const row of ALL_CARDS) {
    const card = REG.getCard(row.card_key), cls = row.metadata.requires_class;
    const who = unitOf(citizen(cls || 'guard', 'trained'));
    const prev = FM.previewEffect(card.formula, who);
    const foe = () => ({ side: 'enemy', hp: 70, maxHp: 70, block: 0, buffs: {}, enemy_key: 'stoat_brigand', flags: {}, _intent: mv('x', 'x', 'damage: 14'), strength: 0, pos: 1 });
    const mates = [0, 1, 2].map(i => ({ ...unitOf(citizen('guard', 'trained')), hp: 40, pos: i + 2 }));
    const me = { ...who, hp: Math.round(who.maxHp * 0.6), pos: 1 };
    const s = { units: [me, ...mates, foe(), { ...foe(), pos: 2 }, { ...foe(), pos: 3 }], deck: { hand: [], drawPile: [], discardPile: [], energy: 3 } };
    const t = card.target === 'enemy' ? s.units[4] : (card.target === 'ally' ? mates[0] : me);
    const v = cardValue(s, me, card, t);
    const per = v / Math.max(card.cost, 1);
    if (row.card_key === 'strike') strikeRef = per;
    console.log(pad(card.name, 20) + pad(cls || '—', 14) + pad(card.cost, 5) + pad(prev.slice(0, 42), 44) + pad(v.toFixed(0), 6) + pad(card.cost === 0 ? 'free' : per.toFixed(1), 11) + (strikeRef ? (per / strikeRef * 100).toFixed(0) + '%' : ''));
  }
}
function reportMonsters() {
  console.log(pad('creature', 26) + pad('rank', 9) + pad('family', 10) + pad('hp', 5) + pad('dmg/turn', 10) + pad('threat', 8) + pad('CR', 5) + 'land');
  for (const m of MONSTERS) {
    const t = threatOf(m);
    console.log(pad((m.isNew ? '' : '*') + m.name, 26) + pad(m.rank, 9) + pad(m.family, 10) + pad(m.stats.maxHp, 5) + pad(t.perTurn.toFixed(1), 10) + pad(t.tp.toFixed(0), 8) + pad(crOf(m), 5) + m.biomes.join(', '));
  }
  console.log('\n* already in the game.  CR = threat / 10, to the nearest half.');
  const c = unitOf(citizen('guard', 'trained'));
  console.log('For scale: a trained Guard has ' + c.maxHp + ' health and a Strike of ' + Math.round(4 + c.strength * 0.6 + c.combatSkill * 0.8) + ', about 2 to 3 cards a turn.');
}
function row(label, r) {
  console.log(pad(label, 46) + pad(pct(r.clear), 8) + pad(pct(r.lossPerFight), 12) + pad(r.turnsPerFight.toFixed(1), 12) + pad(r.turnsPerRun.toFixed(0), 10) + pad(r.down.toFixed(1), 8) + pct(r.hpLeft));
}
const HEAD = () => console.log(pad('', 46) + pad('clears', 8) + pad('hp/fight', 12) + pad('turns/fight', 12) + pad('turns/run', 10) + pad('downed', 8) + 'hp left');
function reportTiers(n) {
  loadCards(DEFAULT_RULES);
  console.log('Clear rate over ' + n + ' runs each (bot player, drafted deck, no supplies, no reviving in battle).\n');
  for (const tier of Object.keys(PLANS)) {
    const p = PLANS[tier], f = p.rooms.filter(r => Array.isArray(r)).length;
    console.log('── ' + tier.toUpperCase() + ' — ' + f + ' fights, deck ' + p.deck + ', +' + pct(TIERS[tier].hp) + ' health, +' + pct(TIERS[tier].str) + ' strength');
    HEAD();
    const [lvl, size] = p.party;
    row('suggested: ' + size + ' ' + lvl + ', starter cards only', trial(tier, {}, n));
    row(size + ' ' + lvl + ', starter + unlocked cards', trial(tier, { unlocks: true }, n));
    const mix = ['guard', 'archer', 'hearthkeeper', 'wizard'].slice(0, size);
    row(size + ' ' + lvl + ' with classes (' + mix.join(', ') + ')', trial(tier, { unlocks: true, classes: mix }, n));
    if (size > 1) row((size - 1) + ' ' + lvl + ' (one short)', trial(tier, { size: size - 1 }, n));
    const order = Object.keys(LEVELS), up = order[Math.min(order.length - 1, order.indexOf(lvl) + 1)], dn = order[Math.max(0, order.indexOf(lvl) - 1)];
    if (dn !== lvl) row(size + ' ' + dn + ' (under-levelled)', trial(tier, { level: dn }, n));
    if (up !== lvl) row(size + ' ' + up + ' (over-levelled)', trial(tier, { level: up }, n));
    console.log('');
  }
}
function reportRules(n) {
  console.log('Orange dungeon, 4 trained citizens, starter + unlocked cards, ' + n + ' runs.\n');
  HEAD();
  const variants = [
    ['proposed rules', DEFAULT_RULES],
    ['weak/vulnerable never wear off (today)', { ...DEFAULT_RULES, decay: false }],
    ['Focus does not wither (today)', { ...DEFAULT_RULES, focusWithers: false }],
    ['both as today', { ...DEFAULT_RULES, decay: false, focusWithers: false }],
  ];
  for (const [label, rules] of variants) { loadCards(rules); row(label, trial('orange', { unlocks: true, rules }, n)); }
  console.log('\nClass cards (4 trained: guard, archer, hearthkeeper, wizard):');
  HEAD();
  loadCards(DEFAULT_RULES);
  row('class-aware offers + class-aware draw', trial('orange', { unlocks: true, classes: ['guard', 'archer', 'hearthkeeper', 'wizard'] }, n));
  row('class cards drawn by anyone (dead cards)', trial('orange', { unlocks: true, classes: ['guard', 'archer', 'hearthkeeper', 'wizard'], rules: { ...DEFAULT_RULES, classDraw: false } }, n));
  row('class cards not favoured in offers', trial('orange', { unlocks: true, classes: ['guard', 'archer', 'hearthkeeper', 'wizard'], rules: { ...DEFAULT_RULES, classOffers: false } }, n));
  console.log('\nDrafted deck against the default home deck (4 trained, no classes):');
  HEAD();
  row('draft of 14 from starter + unlocked', trial('orange', { unlocks: true }, n));
  row('default deck (5 Strike, 5 Defend, 2 Jab, 1 Rally)', trial('orange', { homeDeck: { strike: 5, defend: 5, quick_jab: 2, rally: 1 } }, n));
}

if (cmd0() === 'quick') { loadCards(DEFAULT_RULES); HEAD(); for (const t of Object.keys(PLANS)) { row(t + ' suggested', trial(t, { unlocks: true }, parseInt(process.argv[3], 10) || 200)); row(t + ' classes', trial(t, { unlocks: true, classes: ['guard', 'archer', 'hearthkeeper', 'wizard'].slice(0, PLANS[t].party[1]) }, parseInt(process.argv[3], 10) || 200)); } process.exit(0); }
function cmd0() { return process.argv[2]; }
const cmd = process.argv[2] || 'tiers', n = parseInt(process.argv[3], 10) || 300;
if (cmd === 'cards') reportCards();
else if (cmd === 'monsters') reportMonsters();
else if (cmd === 'rules') reportRules(n);
else reportTiers(n);

module.exports = { ALL_CARDS, CLASS_CARDS, MONSTERS, CLASSES, TIERS, PLANS };
