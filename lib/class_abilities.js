// ══════════════════════════════════════════════════════════════════════════
//  class_abilities — the catalogue: every ability a citizen can have in a
//  battle, and the numbers it is worked out from.
//
//  An ability's damage, block and healing are formulas in the citizen's own
//  stats (strength, agility, endurance, intelligence, charisma, combat), so
//  the same Strike is worth more in stronger hands. lib/tactics_setup.js
//  reads a formula (read()), and adds what the board needs to know that a
//  formula does not say: reach, shape, how often (KITS), and the words for
//  it (SAY).
//
//    ABILITIES        key → { key, name, cls, target, formula, desc, hit, falloff }
//    ability(key)     one of them, or null
//    CLASSES          the five ways to fight: guard, archer, wizard,
//                     hearthkeeper, villager → { label, icon, career }
//    classFor(c)      a citizen's class from their job, and for a villager
//                     the ability their kind of trade gives them (TRADES)
//
//  History: these began as the cards of the class decks (lib/class_cards.js,
//  docs/DUNGEON_CLASS_DECKS.md), tuned with a simulator of whole card runs.
//  The cards went on 2026-11-26 (docs/TACTICS.md §8); the formulas stayed,
//  which is why each definition still carries a cost and a type that
//  nothing reads. Not every entry is in a kit yet: the rest (Bulwark,
//  Thunderclap, Deep Freeze, the plain ones) wait for study at the class
//  buildings (TACTICS.md §6).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

// def(key, name, cls, cost, type, target, formula, desc, extra)
//   cls: guard | archer | wizard | hearthkeeper | villager | trade | common
//   formula: what it does, a line each (damage, block, heal, debuff weak, push …), in the citizen's stats
//   extra.hit 'pierce' with extra.falloff: it goes on down a line, weaker each time
//   (cost, type and the rest of `extra` are what it was as a card; the board does not read them.)
const ABILITIES = {};
function def(key, name, cls, cost, type, target, formula, desc, x = {}) {
  ABILITIES[key] = { key, name, cls, target, formula, desc, hit: x.hit || 'choose', falloff: x.falloff != null ? x.falloff : 1 };
}

// ── Guard (strength / endurance): the wall ──────────────────────────────────
def('g_strike', 'Strike', 'guard', 1, 'attack', 'enemy', 'damage: strength*0.7 + combat*0.8 + 5', 'A hard blow at the creature in front.', { hit: 'front', basic: true });
def('g_shield', 'Shield Up', 'guard', 1, 'defense', 'self', 'block: endurance*0.8 + combat*0.5 + 5', 'Raise the shield.', { basic: true });
def('g_cover', 'Cover', 'guard', 1, 'defense', 'ally', 'block: endurance*0.7 + combat*0.4 + 5', 'Step in front of a friend.');
def('g_shove', 'Shove', 'guard', 1, 'attack', 'enemy', 'damage: strength*0.4 + combat*0.4 + 3\npush: 1\ndebuff weak: 2', 'Knock the front creature back a place and leave it weak.', { hit: 'front' });
def('g_heavy', 'Heavy Blow', 'guard', 2, 'attack', 'enemy', 'damage: strength*1.2 + combat*1.2 + 8', 'Everything behind one swing at the creature in front.', { hit: 'front' });
def('g_stand_fast', 'Stand Fast', 'guard', 1, 'defense', 'self', 'block: endurance*0.9 + combat*0.6 + 7', 'Plant your feet. More block than Shield Up.');
def('g_oath', "Guard's Oath", 'guard', 1, 'defense', 'ally', 'block: endurance*0.8 + combat*0.6 + 7\nbuff block_bonus: 2', 'Block for a friend, and their later blocks hold better.');
def('g_hammer', 'Hammer Blow', 'guard', 2, 'attack', 'enemy', 'damage: strength*1.2 + combat*1.2 + 8\ndebuff weak: 3', 'A crushing hit on the front creature that leaves it weak.', { hit: 'front' });
def('g_hold_line', 'Hold the Line', 'guard', 2, 'defense', 'all_allies', 'block: endurance*0.7 + combat*0.4 + 4', 'Everyone gains block. Once a fight.', { wither: true, rarity: 'rare' });
def('g_shield_bash', 'Shield Bash', 'guard', 2, 'attack', 'enemy', 'damage: endurance*0.5 + combat*0.4 + 2\nstun: 1', 'The front creature loses its next turn.', { hit: 'front', from: 'shield_bash' });
def('g_bulwark', 'Bulwark', 'guard', 2, 'defense', 'all_allies', 'block: endurance*0.4 + combat*0.3 + 2', 'Close ranks: a little block for everyone.', { from: 'bulwark' });

// ── Archer (agility / strength): any target, from the back ──────────────────
def('a_shoot', 'Shoot', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.7 + combat*0.8 + 4', 'An arrow at any creature.', { basic: true });
def('a_side', 'Sidestep', 'archer', 1, 'defense', 'self', 'block: agility*0.6 + combat*0.4 + 4', 'Be somewhere else.', { basic: true });
def('a_part', 'Parting Shot', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.5 + combat*0.6 + 3\nblock: agility*0.3 + 2\nmove: 1', 'Shoot, guard yourself, and step back one place.');
def('a_pierce', 'Piercing Arrow', 'archer', 2, 'attack', 'enemy', 'damage: agility*0.8 + combat*0.8 + 5', 'Through the front creature and on down the line, weaker each time.', { hit: 'pierce', falloff: 0.6 });
def('a_mark', 'Mark', 'archer', 0, 'support', 'enemy', 'debuff vulnerable: 3', 'Every hit on the marked creature lands harder.');
def('a_aimed', 'Aimed Shot', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.8 + combat*0.9 + 6', 'A careful shot. More than Shoot.');
def('a_pin', 'Pin Down', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.4 + combat*0.4 + 2\nslow: 3\ndebuff weak: 3', 'A hit that slows a creature and leaves it weak.');
def('a_hail', 'Hail of Arrows', 'archer', 3, 'attack', 'all_enemies', 'damage: agility*0.8 + combat*0.8 + 5', 'A full hit on every creature. Once a fight.', { wither: true, rarity: 'rare' });
def('a_arrow_rain', 'Arrow Rain', 'archer', 2, 'attack', 'all_enemies', 'damage: agility*0.45 + combat*0.35 + 2', 'A loose volley over the whole line.', { from: 'arrow_rain' });
def('a_hamstring', 'Hamstring', 'archer', 1, 'attack', 'enemy', 'damage: agility*0.35 + combat*0.3 + 1\ndebuff weak: 2\nslow: 2', 'A low shot: weak and slowed.', { from: 'hamstring' });

// ── Wizard (intelligence / agility): weak basics, real spells ───────────────
def('w_spark', 'Spark', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.5 + combat*0.4 + 3', 'A snap of light at any creature.', { basic: true });
def('w_ward', 'Ward', 'wizard', 1, 'defense', 'ally_or_self', 'block: intelligence*0.6 + combat*0.3 + 3', 'A thin shield on yourself or a friend.', { basic: true });
def('w_bolt', 'Firebolt', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.8 + combat*0.6 + 5', 'A bolt of fire at any creature.');
def('w_burst', 'Ember Burst', 'wizard', 2, 'attack', 'all_enemies', 'damage: intelligence*0.6 + combat*0.4 + 2', 'Embers over every creature.');
def('w_chill', 'Chill', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.4 + 2\nslow: 3\ndebuff weak: 3', 'Cold that slows a creature and leaves it weak.');
def('w_scorch', 'Scorch', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.4 + 3\npoison: intelligence*0.3 + 1', 'A burn that keeps burning.');
def('w_ice_ward', 'Ice Ward', 'wizard', 1, 'defense', 'ally_or_self', 'block: intelligence*0.9 + combat*0.4 + 5', 'A wall of ice on yourself or a friend.');
def('w_frost_lance', 'Frost Lance', 'wizard', 1, 'attack', 'enemy', 'damage: intelligence*0.6 + combat*0.5 + 4\nslow: 4\ndebuff weak: 2', 'A lance of ice: a real hit, slowed and weak.');
def('w_thunderclap', 'Thunderclap', 'wizard', 2, 'attack', 'all_enemies', 'damage: intelligence*0.4 + 2\nslow: 3\ndebuff weak: 2', 'Every creature is shaken: slowed and weak.');
def('w_fireball', 'Fireball', 'wizard', 2, 'attack', 'all_enemies', 'damage: intelligence*0.8 + combat*0.5 + 4', 'A ball of fire over every creature.', { rarity: 'rare' });
def('w_deep_freeze', 'Deep Freeze', 'wizard', 2, 'attack', 'enemy', 'damage: intelligence*1.0 + 3\nstun: 1', 'A creature loses its next turn. Once a fight.', { wither: true, rarity: 'rare' });
def('w_chain', 'Chain Lightning', 'wizard', 2, 'attack', 'enemy', 'damage: intelligence*0.9 + combat*0.5 + 5', 'Lightning that jumps down the line, a little weaker each time.', { hit: 'pierce', falloff: 0.7, rarity: 'rare' });

// ── Hearthkeeper (intelligence / charisma): keeps the others standing ───────
def('h_cinder', 'Cinder', 'hearthkeeper', 1, 'attack', 'enemy', 'damage: intelligence*0.5 + combat*0.4 + 3', 'A thrown coal at any creature.', { basic: true });
def('h_ward', 'Hearth Ward', 'hearthkeeper', 1, 'defense', 'ally_or_self', 'block: intelligence*0.6 + charisma*0.3 + 3', 'Warmth that turns a blow, on yourself or a friend.', { basic: true });
def('h_kindle', 'Kindle', 'hearthkeeper', 1, 'support', 'ally_or_self', 'heal: intelligence*0.6 + charisma*0.4 + 4', 'Heal a friend. Spent until the party rests.', { heal: true });
def('h_steady', 'Steady Now', 'hearthkeeper', 1, 'defense', 'all_allies', 'block: charisma*0.4 + 2', 'A calm word: a little block for everyone.');
def('h_bold', 'Embolden', 'hearthkeeper', 0, 'support', 'ally', 'buff damage_bonus: charisma*0.5 + 2', "A friend's next attack lands harder.");
def('h_ember_ward', 'Ember Ward', 'hearthkeeper', 1, 'defense', 'ally_or_self', 'block: intelligence*0.7 + charisma*0.4 + 5\nbuff block_bonus: 2', 'A stronger ward, and their later blocks hold better.');
def('h_banish', 'Banish the Blight', 'hearthkeeper', 1, 'attack', 'enemy', 'damage: intelligence*0.6 + combat*0.5 + 4\nif target_species withered: damage: intelligence*0.4 + 3', 'A good hit, and far more against the Withered.');
def('h_hearthlight', 'Hearthlight', 'hearthkeeper', 2, 'support', 'all_allies', 'heal: intelligence*0.3 + charisma*0.2 + 2', 'Heal everyone a little. Spent until the party rests.', { heal: true });
def('h_rekindle', 'Rekindle', 'hearthkeeper', 2, 'support', 'ally_or_self', 'heal: intelligence*1.2 + charisma*0.5 + 8', 'A great heal for one friend. Spent until the party rests.', { heal: true, rarity: 'rare' });
def('h_battle_cry', 'Battle Cry', 'hearthkeeper', 1, 'support', 'all_allies', 'buff damage_bonus: charisma*0.3 + combat*0.2 + 1', "Everyone's next attack lands harder.", { from: 'battle_cry' });

// ── Villager (no fighting class) ────────────────────────────────────────────
def('v_swing', 'Swing', 'villager', 1, 'attack', 'enemy', 'damage: strength*0.6 + combat*0.8 + 5', 'Hit it with whatever is to hand.', { basic: true });
def('v_duck', 'Duck', 'villager', 1, 'defense', 'self', 'block: endurance*0.7 + combat*0.5 + 5', 'Get out of the way.', { basic: true });
// The Attack of someone whose craft is magic, not blows (a Wizard, a Hearthkeeper): about half a villager's swing.
def('v_knock', 'Knock', 'villager', 1, 'attack', 'enemy', 'damage: strength*0.3 + combat*0.3 + 2', 'A feeble knock with whatever is in hand.', { basic: true });
// Trade cards: one by the kind of job a villager holds.
def('t_tool', 'Tool of the Trade', 'trade', 2, 'attack', 'enemy', 'damage: strength*1.0 + combat*0.8 + 7', 'The axe, pick or pitchfork they use every day, at the creature in front.', { hit: 'front' });
def('t_spot', 'Spot the Weakness', 'trade', 0, 'support', 'enemy', 'debuff vulnerable: 2\ndraw: 1', "A scout's eye: hits on that creature land harder. Draw a card.");
def('t_shore', 'Shore Up', 'trade', 1, 'defense', 'ally_or_self', 'block: endurance*0.5 + 6', "A maker's fix: block on yourself or a friend.");
def('t_ration', 'Share Rations', 'trade', 1, 'support', 'ally_or_self', 'heal: 7', 'Something from the pack. Heals a little. Spent until the party rests.', { heal: true });
def('t_drink', 'Strong Drink', 'trade', 1, 'support', 'ally', 'heal: 4\nbuff damage_bonus: charisma*0.3 + 3', 'Heals a friend a little and their next attack lands harder. Spent until the party rests.', { heal: true });
def('t_signs', 'Read the Signs', 'trade', 1, 'support', 'enemy', 'debuff weak: 3\ndraw: 1', "A scholar's guess at what it will do: the creature is weak. Draw a card.");
// Plain cards any villager can be offered: the class-deck twins of the cards every town starts with.
def('c_quick_jab', 'Quick Jab', 'common', 0, 'attack', 'enemy', 'damage: agility*0.5 + combat*0.4 + 2', 'A free, light hit.');
def('c_cleave', 'Cleave', 'common', 2, 'attack', 'all_enemies', 'damage: strength*0.5 + combat*0.4 + 3', 'A wide swing at every creature.');
def('c_weaken', 'Weaken', 'common', 1, 'support', 'enemy', 'debuff weak: intelligence*0.3 + combat*0.2 + 2', 'A creature hits less hard.');
def('c_expose', 'Expose', 'common', 1, 'support', 'enemy', 'debuff vulnerable: agility*0.3 + combat*0.2 + 2', 'Hits on a creature land harder.');
def('c_rally', 'Rally', 'common', 1, 'support', 'ally', 'buff damage_bonus: charisma*0.4 + combat*0.2 + 2', "A friend's next attack lands harder.");
def('c_venom_edge', 'Venom Edge', 'common', 1, 'attack', 'enemy', 'damage: agility*0.3 + combat*0.3 + 1\npoison: 3', 'A small cut that poisons.', { from: 'venom_edge' });
def('c_second_wind', 'Second Wind', 'common', 1, 'support', 'self', 'heal: endurance*0.5 + combat*0.2 + 3\ndraw: 1', 'Heal yourself a little and draw a card. Spent until the party rests.', { heal: true, from: 'second_wind' });
def('c_smoke_bomb', 'Smoke Bomb', 'common', 1, 'defense', 'all_allies', 'block: intelligence*0.3 + combat*0.2 + 2', 'A little block for everyone.', { from: 'smoke_bomb' });

// ── The five ways to fight ──────────────────────────────────────────────────
// career: the job (lib/careers/classes.js) whose citizens fight this way, and whose levels teach it.
const CLASSES = {
  guard:        { label: 'Guard',        icon: '🛡️', career: 'soldier' },
  archer:       { label: 'Archer',       icon: '🏹', career: 'archer' },
  wizard:       { label: 'Wizard',       icon: '🔮', career: 'wizard' },
  hearthkeeper: { label: 'Hearthkeeper', icon: '🔥', career: 'hearthkeeper' },
  villager:     { label: 'Villager',     icon: '🧺', career: null },
};
const CLASS_ORDER = ['guard', 'archer', 'wizard', 'hearthkeeper', 'villager'];
// A villager's third ability, by the kind of job they have (lib/careers/classes.js `kind`).
const TRADES = { gathering: 't_tool', travel: 't_spot', crafting: 't_shore', trade: 't_ration', service: 't_drink', learning: 't_signs' };
const classOfRole = role => Object.keys(CLASSES).find(k => CLASSES[k].career && CLASSES[k].career === role) || 'villager';

// A citizen's class, and for a villager their trade's ability (null with no job, or a job of no such kind).
function classFor(citizen) {
  const role = (citizen && citizen.role) || 'idle';
  const cls = classOfRole(role);
  let trade = null;
  if (cls === 'villager') {
    let kind = null;
    try { kind = (require('./careers/classes').CLASSES[role] || {}).kind || null; } catch (e) { /* no careers */ }
    trade = TRADES[kind] || null;
  }
  return { cls, trade };
}

const ability = key => ABILITIES[key] || null;

module.exports = { ABILITIES, CLASSES, CLASS_ORDER, TRADES, classOfRole, classFor, ability };
