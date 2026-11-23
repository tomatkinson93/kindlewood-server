// ══════════════════════════════════════════════════════════════════════════
//  class_cards — the cards of the class decks (docs/DUNGEON_CLASS_DECKS.md).
//
//  Every citizen brings their own deck into a dungeon: their class's base
//  pack, or the Villager pack with one trade card from their job. This file
//  is the data: the cards, the packs, what a town can unlock for each class
//  and how, and the honed (enhanced) form of every card.
//
//    CARDS           every class card: key → definition
//    PACKS           class → { label, career, deck: { card: copies } }
//    packFor(c)      a citizen's class and starting deck, from their job
//    UNLOCKS         card → how a town comes to own it (a building's level,
//                    or an older card the town has already unlocked)
//    ownedFor(sid)   the unlock cards a town owns
//    poolFor(…)      what a citizen can be offered
//    honed(key)      the key of a card's honed form; isHoned, baseOf
//    seed()          writes every card (and its honed form) to card_templates
//                    once; an admin's later edits are kept
//
//  These cards are for class decks only: they are marked `metadata.dungeon`
//  and stay out of the home collection, its random drops and the deck
//  builder (lib/cards.js). An older general card a town has unlocked
//  (Shield Bash, Arrow Rain…) counts for its class-deck twin (`from`).
//
//  The numbers were set with a simulator of whole card runs
//  (scripts/class_deck_sim.js, removed with the dungeons' card battles on
//  2026-11-23). Today this file is read by the board: an ability takes its
//  numbers from its card's formula (lib/tactics_setup.js). The packs, the
//  pools and honing are no longer used by anything, and go when the card
//  battler does (docs/TACTICS.md §8, step 3).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');

// def(key, name, cls, cost, type, target, formula, desc, extra)
//   cls: guard | archer | wizard | hearthkeeper | villager | trade | common
//   extra: hit ('front' | 'pierce'), falloff, wither, heal, rarity, basic
const CARDS = {};
function def(key, name, cls, cost, type, target, formula, desc, x = {}) {
  CARDS[key] = { key, name, cls, cost, type, target, formula, desc, hit: x.hit || 'choose', falloff: x.falloff != null ? x.falloff : 1,
    wither: !!x.wither || !!x.heal, heal: !!x.heal, rarity: x.rarity || 'common', basic: !!x.basic, from: x.from || null };
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

// ── Packs: ten cards each ───────────────────────────────────────────────────
const PACKS = {
  guard:        { label: 'Guard',        icon: '🛡️', career: 'soldier',      deck: { g_strike: 3, g_shield: 3, g_cover: 2, g_shove: 1, g_heavy: 1 } },
  archer:       { label: 'Archer',       icon: '🏹', career: 'archer',       deck: { a_shoot: 3, a_side: 3, a_part: 2, a_pierce: 1, a_mark: 1 } },
  wizard:       { label: 'Wizard',       icon: '🔮', career: 'wizard',       deck: { w_spark: 3, w_ward: 3, w_bolt: 2, w_burst: 1, w_chill: 1 } },
  hearthkeeper: { label: 'Hearthkeeper', icon: '🔥', career: 'hearthkeeper', deck: { h_cinder: 3, h_ward: 3, h_kindle: 1, h_steady: 1, h_bold: 2 } },
  villager:     { label: 'Villager',     icon: '🧺', career: null,           deck: { v_swing: 5, v_duck: 3 } },
};
const CLASS_ORDER = ['guard', 'archer', 'wizard', 'hearthkeeper', 'villager'];
// The trade card by the kind of job (lib/careers/classes.js `kind`); two copies in a villager's deck.
const TRADES = { gathering: 't_tool', travel: 't_spot', crafting: 't_shore', trade: 't_ration', service: 't_drink', learning: 't_signs' };
const TRADE_COPIES = 2;
const classOfRole = role => Object.keys(PACKS).find(k => PACKS[k].career && PACKS[k].career === role) || 'villager';

// A citizen's class and starting deck. A villager with no job (or one whose
// kind has no trade card) takes one more Swing and one more Duck instead.
function packFor(citizen) {
  const role = (citizen && citizen.role) || 'idle';
  const cls = classOfRole(role);
  const deck = { ...PACKS[cls].deck };
  let trade = null;
  if (cls === 'villager') {
    let kind = null;
    try { kind = (require('./careers/classes').CLASSES[role] || {}).kind || null; } catch (e) { /* no careers */ }
    trade = TRADES[kind] || null;
    if (trade) deck[trade] = TRADE_COPIES;
    else { deck.v_swing += 1; deck.v_duck += 1; }
  }
  return { cls, deck, trade };
}

// ── What a town can unlock, and how ─────────────────────────────────────────
// { building, level }: owned while the town has that building at that level.
// A card with `from` is owned when the town has unlocked the older general
// card of that name (settlement_unlocked_cards). A row in
// settlement_unlocked_cards for the class card itself (a dungeon find, an
// admin grant) owns it too.
const UNLOCKS = {
  g_stand_fast: { building: 'watchtower', level: 1 }, g_oath: { building: 'watchtower', level: 2 }, g_hammer: { building: 'watchtower', level: 3 }, g_hold_line: { building: 'watchtower', level: 4 },
  a_aimed: { building: 'watchtower', level: 1 }, a_pin: { building: 'watchtower', level: 2 }, a_hail: { building: 'watchtower', level: 4 },
  w_scorch: { building: 'wizard_tower', level: 1 }, w_ice_ward: { building: 'wizard_tower', level: 1 }, w_frost_lance: { building: 'wizard_tower', level: 2 }, w_thunderclap: { building: 'wizard_tower', level: 2 },
  w_fireball: { building: 'wizard_tower', level: 3 }, w_deep_freeze: { building: 'wizard_tower', level: 3 }, w_chain: { building: 'wizard_tower', level: 3 },
  h_ember_ward: { building: 'hearth_shrine', level: 1 }, h_banish: { building: 'hearth_shrine', level: 2 }, h_hearthlight: { building: 'hearth_shrine', level: 2 }, h_rekindle: { building: 'hearth_shrine', level: 3 },
};
const BUILDING_LABEL = { watchtower: 'Watchtower', wizard_tower: "Wizard's Tower", hearth_shrine: 'Hearth Shrine' };
const isUnlock = key => !!(UNLOCKS[key] || (CARDS[key] && CARDS[key].from));
function howTo(key) {
  const u = UNLOCKS[key], c = CARDS[key];
  if (u) return `${BUILDING_LABEL[u.building] || u.building} level ${u.level}`;
  if (c && c.from) return `Owned once the town has the card ${c.name} (won in battle, found on quests, or taught by an Allied village)`;
  return '';
}
// The unlock cards a town owns → Set of keys.
async function ownedFor(sid, db) {
  const run = db && db.query ? (t, p) => db.query(t, p) : query;
  const levels = {};
  for (const b of (await run('SELECT type, MAX(level)::int AS level FROM buildings WHERE settlement_id=$1 GROUP BY type', [sid]).catch(() => ({ rows: [] }))).rows) levels[b.type] = b.level;
  const have = new Set((await run('SELECT card_key FROM settlement_unlocked_cards WHERE settlement_id=$1', [sid]).catch(() => ({ rows: [] }))).rows.map(r => r.card_key));
  const out = new Set();
  for (const key of Object.keys(CARDS)) {
    const u = UNLOCKS[key], c = CARDS[key];
    if (have.has(key)) out.add(key);
    else if (u && (levels[u.building] || 0) >= u.level) out.add(key);
    else if (c.from && have.has(c.from)) out.add(key);
  }
  return out;
}
// Cards the player has set aside ("not prepared"): never offered. → Set of keys.
async function unpreparedFor(sid, db) {
  const run = db && db.query ? (t, p) => db.query(t, p) : query;
  return new Set((await run('SELECT card_key FROM settlement_card_prefs WHERE settlement_id=$1 AND prepared = FALSE', [sid]).catch(() => ({ rows: [] }))).rows.map(r => r.card_key));
}
// What a citizen of this class (with this trade card, if a villager) can be
// offered: their pack's own class cards, the plain cards for a villager, and
// the unlock cards the town owns for that class; less what is not prepared.
// Never empty: with everything set aside, the pack's own cards are offered.
function poolFor(cls, trade, owned, unprepared) {
  const own = Object.keys(PACKS[cls].deck).filter(k => !CARDS[k].basic).concat(trade ? [trade] : []);
  const classes = cls === 'villager' ? ['common'] : [cls];
  const more = Object.keys(CARDS).filter(k => classes.includes(CARDS[k].cls) && !CARDS[k].basic && (!isUnlock(k) || (owned && owned.has(k))));
  const all = [...new Set(own.concat(more))];
  const ready = all.filter(k => !(unprepared && unprepared.has(k)));
  return ready.length ? ready : own;
}

// ── Honing (the game's word for enhancing a card) ───────────────────────────
// A honed card does about a third more: its damage, block, healing and
// lasting effects are multiplied by HONE. A card with none of those costs one
// less instead. The honed form is a card of its own (`<key>_honed`), so the
// engine needs no new rule.
const HONE = 1.3;
const HONED = '_honed';
const honed = key => (isHoned(key) ? key : key + HONED);
const isHoned = key => String(key).endsWith(HONED);
const baseOf = key => (isHoned(key) ? String(key).slice(0, -HONED.length) : key);
function honedFormula(formula) {
  let touched = false;
  const lines = String(formula).split('\n').map(line => {
    const m = line.match(/^(\s*(?:if [^:]+:\s*)?)(damage|block|heal|poison|buff \w+|debuff \w+)(\s*:\s*)(.+)$/);
    if (!m) return line;
    touched = true;
    return `${m[1]}${m[2]}${m[3]}(${m[4].trim()})*${HONE}`;
  });
  return { formula: lines.join('\n'), touched };
}
function honedDef(key) {
  const c = CARDS[baseOf(key)];
  if (!c) return null;
  const h = honedFormula(c.formula);
  return { ...c, key: honed(c.key), name: c.name + ' ✦', formula: h.formula, cost: h.touched ? c.cost : Math.max(0, c.cost - 1),
    desc: c.desc + (h.touched ? ' Honed: about a third stronger.' : ' Honed: costs one less.'), honed: true };
}
// Any card of the class decks, honed or not.
const card = key => (isHoned(key) ? honedDef(key) : CARDS[key]) || null;
const allKeys = () => Object.keys(CARDS).concat(Object.keys(CARDS).map(honed));

// ── Into card_templates ─────────────────────────────────────────────────────
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
function rowOf(key) {
  const c = card(key);
  return { card_key: c.key, name: c.name, cost: c.cost, card_type: c.type, target: c.target, rarity: c.rarity, rarity_order: RARITY_ORDER[c.rarity] || 0,
    description: c.desc, formula: c.formula, hit: c.hit, pierce_count: null, pierce_falloff: c.falloff, wither: c.wither,
    metadata: { dungeon: true, cls: c.cls, heal: c.heal || undefined, honed: c.honed || undefined, basic: c.basic || undefined } };
}
// Every class card and its honed form, written once. A row that is already
// there is left as it is, so an admin's edit in the card editor is kept.
async function seed(db) {
  const run = db && db.query ? (t, p) => db.query(t, p) : query;
  let n = 0;
  for (const key of allKeys()) {
    const r = rowOf(key);
    const res = await run(
      `INSERT INTO card_templates (card_key, name, cost, card_type, target, rarity, rarity_order, description, formula, hit, pierce_count, pierce_falloff, wither, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (card_key) DO NOTHING`,
      [r.card_key, r.name, r.cost, r.card_type, r.target, r.rarity, r.rarity_order, r.description, r.formula, r.hit, r.pierce_count, r.pierce_falloff, r.wither, JSON.stringify(r.metadata)]);
    n += res.rowCount || 0;
  }
  return n;
}
const isClassCard = key => !!CARDS[baseOf(key)];

module.exports = {
  CARDS, PACKS, CLASS_ORDER, TRADES, TRADE_COPIES, UNLOCKS, HONE,
  classOfRole, packFor, isUnlock, howTo, ownedFor, unpreparedFor, poolFor,
  honed, isHoned, baseOf, honedFormula, card, allKeys, rowOf, seed, isClassCard,
};
