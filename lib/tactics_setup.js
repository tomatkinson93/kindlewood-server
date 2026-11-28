// ══════════════════════════════════════════════════════════════════════════
//  tactics_setup — the two sides of a battle on the board (docs/TACTICS.md).
//  The battle itself is played by the rules in lib/tactics_engine.js (the
//  browser's js/tactics-engine.js is the same file); this file turns citizens
//  and foes into the units those rules take.
//
//  Every ability is an entry in the catalogue (lib/class_abilities.js) and
//  takes its numbers from that entry's formula, read with the citizen's own
//  stats. This file adds what a board needs: how far it reaches, its shape,
//  how often it can be used, the class level that teaches it, and the words
//  for it.
//
//    KITS            class → { move, jump, abilities: [key + board facts] }
//    TIERS, QUEST    how much tougher foes are at each skull, and in a quest's fight
//    LEVELS          the playtest levels (villager, novice, trained, veteran)
//    partyFor(ids, { mods })  citizens as they are → units
//    foesFor(keys, tier, boost) → units
//    build(userId, opts) → { seed, land, tier, name, band, party, enemies }   a practice battle
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const CC = require('./class_abilities');
const err = (status, msg) => Object.assign(new Error(msg), { status });

// ── Reading a card's formula into numbers ───────────────────────────────────
const ALIAS = { combat: 'combatSkill' };
// A small calculator: numbers, stat names, + - * /, brackets.
function calc(expr, stats) {
  const tokens = String(expr).match(/\d+\.?\d*|[a-z_]+|[()+\-*/]/gi) || [];
  let i = 0;
  const peek = () => tokens[i], take = () => tokens[i++];
  function factor() {
    const t = take();
    if (t === '(') { const v = sum(); take(); return v; }
    if (t === '-') return -factor();
    if (/^\d/.test(t)) return Number(t);
    const k = ALIAS[t] || t;
    return Number(stats[k]) || 0;
  }
  function term() { let v = factor(); while (peek() === '*' || peek() === '/') { const op = take(), r = factor(); v = op === '*' ? v * r : (r ? v / r : 0); } return v; }
  function sum() { let v = term(); while (peek() === '+' || peek() === '-') { const op = take(), r = term(); v = op === '+' ? v + r : v - r; } return v; }
  return sum();
}
// A formula's lines → { dmg, block, heal, fx: { weak, … } }. Lines the board
// has no use for (draw a card, gain energy) and conditions are left out.
const FX = { 'debuff weak': 'weak', 'debuff vulnerable': 'vulnerable', 'buff damage_bonus': 'bold', slow: 'slow', stun: 'stun', poison: 'poison', push: 'push', move: 'step' };
function read(formula, stats) {
  const out = { fx: {} };
  for (const line of String(formula || '').split('\n')) {
    if (/^\s*if\b/.test(line)) continue;
    const m = line.match(/^\s*([a-z_]+(?: [a-z_]+)?)\s*:\s*(.+)$/i);
    if (!m) continue;
    const verb = m[1].toLowerCase(), n = Math.max(0, Math.round(calc(m[2], stats)));
    if (verb === 'damage') out.dmg = (out.dmg || 0) + n;
    else if (verb === 'block') out.block = (out.block || 0) + n;
    else if (verb === 'heal') out.heal = (out.heal || 0) + n;
    else if (FX[verb]) out.fx[FX[verb]] = (out.fx[FX[verb]] || 0) + n;
  }
  return out;
}

// ── The kits: a class's cards, as abilities on a board ──────────────────────
// min, max: reach in steps (max 1 = a melee blow; 0 = oneself). shape:
// 'single' (default), 'line' (down a row), 'burst' (a tile and its
// neighbours), 'around' (everyone near the user). cooldown: turns before it
// is ready again. quick: does not use up the turn's action. uses: per battle.
// at: the class level at which it is learned (the ladder, docs/TACTICS.md §6):
// two to begin with, then one each at levels 2, 4 and 6 (the first five: the
// kit the skulls were tuned with), and five more at 8, 10, 13, 16 and 20.
// A citizen brings READY of what they know into a battle: the first five
// unless they have chosen otherwise at home (citizen_classes.ready). A
// villager's are all known from the start.
const GEAR = require('./gear_kinds');
const READY = 5;            // (kept for old callers: the five a citizen once chose among their own class's abilities)
// ── Schools (docs/TACTICS.md §6, decided 2026-11-26) ────────────────────────
// Every ability belongs to a school. A citizen brings everything their
// current class has taught them, and up to SECOND from one other class they
// have levels in (their second school), which work at OFF strength.
const SCHOOLS = {
  basics:  { name: 'Basics',       icon: '🪵' },
  arms:    { name: 'Arms',         icon: '⚔️', cls: 'guard' },
  archery: { name: 'Archery',      icon: '🏹', cls: 'archer' },
  wild:    { name: 'Wild magic',   icon: '🔮', cls: 'wizard' },
  hearth:  { name: 'Hearth magic', icon: '🔥', cls: 'hearthkeeper' },
  field:   { name: 'Fieldcraft',   icon: '🧰' },
  lore:    { name: 'Village lore', icon: '🏡' },      // what an Allied village taught them (lib/tactics_lore.js)
};
const SCHOOL_OF = { guard: 'arms', archer: 'archery', wizard: 'wild', hearthkeeper: 'hearth', villager: 'basics' };
// The Attack (the owner, 2026-11-27): everyone has one, on its own button, apart from their abilities.
// It is their class's: a Guard's Strike and an Archer's Shoot hit well, a villager swings, and someone
// whose craft is magic (a Wizard, a Hearthkeeper) can only knock with what they hold.
const ATTACK = { guard: 'g_strike', archer: 'a_shoot', wizard: 'v_knock', hearthkeeper: 'v_knock', villager: 'v_swing' };
const ATTACK_KEYS = new Set(Object.values(ATTACK));
const SECOND = 5;           // abilities brought from the second school
const OFF = 0.75;           // their strength: damage, healing and block
const A = (key, x) => ({ key, ...x });
const KITS = {
  guard: { move: 3, jump: 1, abilities: [
    A('g_strike', { at: 1, icon: '⚔️', min: 1, max: 1 }),
    A('g_shield', { at: 1, icon: '🛡️', max: 0, cooldown: 1 }),
    A('g_cover',  { at: 2, icon: '🤝', min: 1, max: 2, cooldown: 1 }),
    A('g_shove',  { at: 4, icon: '💨', min: 1, max: 1, cooldown: 2 }),
    A('g_heavy',  { at: 6, icon: '🔨', min: 1, max: 1, cooldown: 3 }),
    A('g_stand_fast',  { at: 8,  icon: '🧱', max: 0, cooldown: 1 }),
    A('g_shield_bash', { at: 10, icon: '💫', min: 1, max: 1, cooldown: 3 }),
    A('g_oath',        { at: 13, icon: '🤞', min: 1, max: 3, cooldown: 2 }),
    A('g_hold_line',   { at: 16, icon: '🚧', shape: 'around', radius: 2, uses: 1 }),
    A('g_hammer',      { at: 20, icon: '⚒️', min: 1, max: 1, cooldown: 3 }),
  ] },
  archer: { move: 3, jump: 2, abilities: [
    A('a_shoot',  { at: 1, icon: '🏹', min: 2, max: 5 }),
    A('a_side',   { at: 1, icon: '🌀', max: 0, cooldown: 1 }),
    A('a_part',   { at: 2, icon: '↩️', min: 1, max: 3, cooldown: 2 }),
    A('a_pierce', { at: 6, icon: '➶', min: 1, max: 5, shape: 'line', cooldown: 3 }),
    A('a_mark',   { at: 4, icon: '🎯', min: 1, max: 5, quick: true, cooldown: 2 }),
    A('a_aimed',      { at: 8,  icon: '🎯', min: 2, max: 6, cooldown: 1 }),
    A('a_hamstring',  { at: 10, icon: '🦵', min: 1, max: 4, cooldown: 2 }),
    A('a_arrow_rain', { at: 13, icon: '🌧️', min: 2, max: 5, shape: 'burst', radius: 1, cooldown: 3 }),
    A('a_pin',        { at: 16, icon: '📌', min: 2, max: 5, cooldown: 2 }),
    A('a_hail',       { at: 20, icon: '☔', min: 2, max: 5, shape: 'burst', radius: 2, uses: 1 }),
  ] },
  wizard: { move: 3, jump: 1, abilities: [
    A('w_spark',  { at: 1, icon: '✨', min: 1, max: 4 }),
    A('w_ward',   { at: 1, icon: '🔰', min: 0, max: 3, cooldown: 1 }),
    A('w_bolt',   { at: 2, icon: '🔥', min: 1, max: 4, cooldown: 1 }),
    A('w_burst',  { at: 6, icon: '💥', min: 1, max: 4, shape: 'burst', radius: 1, cooldown: 3 }),
    A('w_chill',  { at: 4, icon: '❄️', min: 1, max: 4, cooldown: 2 }),
    A('w_scorch',      { at: 8,  icon: '♨️', min: 1, max: 4, cooldown: 1 }),
    A('w_ice_ward',    { at: 10, icon: '🧊', min: 0, max: 3, cooldown: 1 }),
    A('w_frost_lance', { at: 13, icon: '🔱', min: 1, max: 5, cooldown: 2 }),
    A('w_chain',       { at: 16, icon: '⚡', min: 1, max: 5, shape: 'line', cooldown: 3 }),
    A('w_fireball',    { at: 20, icon: '☄️', min: 2, max: 5, shape: 'burst', radius: 2, cooldown: 4 }),
  ] },
  hearthkeeper: { move: 3, jump: 1, abilities: [
    A('h_cinder', { at: 1, icon: '🔥', min: 1, max: 3 }),
    A('h_ward',   { at: 2, icon: '🔰', min: 0, max: 3, cooldown: 1 }),
    A('h_kindle', { at: 1, icon: '💗', min: 0, max: 3, uses: 2 }),      // a Hearthkeeper heals from their first day: it is what the class is
    A('h_steady', { at: 6, icon: '🕊️', shape: 'around', radius: 2, cooldown: 2 }),
    A('h_bold',   { at: 4, icon: '📣', min: 1, max: 3, quick: true, cooldown: 2 }),
    A('h_ember_ward',  { at: 8,  icon: '🏵️', min: 0, max: 3, cooldown: 1 }),
    A('h_banish',      { at: 10, icon: '🌟', min: 1, max: 4, cooldown: 1 }),
    A('h_battle_cry',  { at: 13, icon: '📯', shape: 'around', radius: 2, cooldown: 3 }),
    A('h_hearthlight', { at: 16, icon: '🕯️', shape: 'around', radius: 2, uses: 1 }),
    A('h_rekindle',    { at: 20, icon: '❤️‍🔥', min: 0, max: 3, uses: 1 }),
  ] },
  villager: { move: 3, jump: 1, abilities: [
    A('v_swing',  { icon: '🪵', min: 1, max: 1 }),
    A('v_duck',   { icon: '🙇', max: 0, cooldown: 1 }),
  ] },
};
// A villager's trade card, as their third ability.
const TRADE_KIT = {
  t_tool:   A('t_tool',   { icon: '⛏️', min: 1, max: 1, cooldown: 2 }),
  t_spot:   A('t_spot',   { icon: '👁️', min: 1, max: 4, quick: true, cooldown: 2 }),
  t_shore:  A('t_shore',  { icon: '🧱', min: 0, max: 2, cooldown: 1 }),
  t_ration: A('t_ration', { icon: '🍞', min: 0, max: 2, uses: 1 }),
  t_drink:  A('t_drink',  { icon: '🍺', min: 1, max: 2, uses: 1 }),
  t_signs:  A('t_signs',  { icon: '📖', min: 1, max: 4, cooldown: 2 }),
};
// What each does, said for the board. (The cards' own lines speak of the card battles: "the creature in
// front", "draw a card", "spent until the party rests".) Shown on the Abilities page and as a button's tooltip.
const SAY = {
  g_strike: 'A hard blow at a foe beside you.', g_shield: 'Raise the shield.', g_cover: 'Step in front of a friend: block for them.',
  g_shove: 'Knock a foe back a tile and leave it weak.', g_heavy: 'Everything behind one swing.',
  g_stand_fast: 'Plant your feet. More block than Shield Up.', g_shield_bash: 'The foe loses its next turn.',
  g_oath: 'A strong block for a friend up to three tiles away.', g_hold_line: 'Block for you and every friend within two tiles.',
  g_hammer: 'A crushing hit that leaves the foe weak.',
  a_shoot: 'An arrow at a foe in reach.', a_side: 'Be somewhere else: block for yourself.', a_part: 'Shoot, guard yourself, and step back a tile.',
  a_pierce: 'Through the first foe and on down the line, weaker each time.', a_mark: 'Every hit on the marked foe lands harder.',
  a_aimed: 'A careful shot. Further and harder than Shoot.', a_hamstring: 'A low shot: weak and slowed.',
  a_arrow_rain: 'A loose volley on a foe and those beside it.', a_pin: 'A hit that slows a foe and leaves it weak.',
  a_hail: 'A full hit on a foe and every foe within two tiles of it.',
  w_spark: 'A snap of light at a foe in reach.', w_ward: 'A thin shield on yourself or a friend.', w_bolt: 'A bolt of fire.',
  w_burst: 'Embers over a foe and those beside it.', w_chill: 'Cold that slows a foe and leaves it weak.',
  w_scorch: 'A burn that keeps burning, turn after turn.', w_ice_ward: 'A wall of ice on yourself or a friend.',
  w_frost_lance: 'A lance of ice: a real hit, slowed and weak.', w_chain: 'Lightning down a line of foes, a little weaker each time.',
  w_fireball: 'A ball of fire over a foe and every foe within two tiles of it.',
  h_cinder: 'A thrown coal.', h_ward: 'Warmth that turns a blow, on yourself or a friend.', h_kindle: 'Heal a friend, or stand a fallen one back up.',
  h_steady: 'A calm word: a little block for everyone near.', h_bold: "A friend's next attack lands harder.",
  h_ember_ward: 'A stronger ward, on yourself or a friend.', h_banish: 'A bright coal that bites deep.',
  h_battle_cry: 'The next attack of everyone near lands harder.', h_hearthlight: 'Heal everyone within two tiles a little.',
  h_rekindle: 'A great heal for one friend.',
  v_swing: 'Hit it with whatever is to hand.', v_duck: 'Get out of the way.', v_knock: 'A feeble knock with whatever is in hand.',
  t_tool: 'The axe, pick or pitchfork they use every day.', t_spot: "A scout's eye: hits on that foe land harder.",
  t_shore: "A maker's fix: block on yourself or a friend.", t_ration: 'Something from the pack. Heals a little.',
  t_drink: 'Heals a friend a little, and their next attack lands harder.', t_signs: "A scholar's guess at what it will do: the foe is weak.",
};
const TARGET = { enemy: 'enemy', all_enemies: 'enemy', ally: 'ally', all_allies: 'ally_or_self', ally_or_self: 'ally_or_self', self: 'self' };
// What a weapon in hand adds to every blow: the average of its dice ("1d8", "2d4+1") and its bonus, rounded.
// (The card battles rolled these dice only for a plain attack and never for a card; on the board the weapon
// always counts, and by a steady amount, so a forecast is true.) Most weapons have no dice: their worth is the
// combat skill they add, which is already in the formulas.
function weaponEdge(w) {
  if (!w || !w.dice) return 0;
  const m = String(w.dice).match(/^\s*(\d+)d(\d+)\s*(?:\+\s*(\d+))?\s*$/i);
  if (!m) return 0;
  return Math.max(0, Math.round(Number(m[1]) * (Number(m[2]) + 1) / 2 + (Number(m[3]) || 0) + (Number(w.bonus) || 0)));
}
// opts.school: the school it is listed under; opts.off: brought from the second school, at OFF strength;
// opts.star: mastered by this citizen (lib/tactics_mastery.js), EDGE times as strong; opts.passive: the passive in their slot;
// opts.research: the town's battle research (researchOf); opts.attack: this is the citizen's Attack.
function abilityOf(kit, stats, opts = {}) {
  const c = CC.ability(kit.key);
  const n = read(c.formula, stats);
  if (n.dmg) n.dmg += weaponEdge(stats.weapon);
  // What they carry changes it by its school (lib/gear_kinds.js): a hammer's blow, a staff's spell, a longbow's reach.
  const school = opts.school || schoolOfKey(kit.key), shape = { min: kit.min || 0, max: kit.max || 0, cooldown: kit.cooldown || 0 };
  const worn = stats.gear && (stats.gear.weapon || stats.gear.shield) ? GEAR.describe(stats.gear) : null;
  const extra = GEAR.apply(n, shape, school, worn);
  // The citizen's passive (lib/tactics_study.js), where it changes an ability: Keen Eye, Focus, Quick Hands, Warm Hands, Deep Embers.
  let uses = kit.uses != null ? kit.uses : null;
  const P = opts.passive, PV = require('./tactics_study').PASSIVE;
  if (P === 'keen_eye' && school === 'archery' && shape.max >= 2) shape.max += 1;
  if (P === 'focus' && school === 'wild') for (const k of ['dmg', 'heal', 'block']) if (n[k]) n[k] = Math.round(n[k] * PV.FOCUS);
  if (P === 'quick_hands' && school === 'wild' && shape.cooldown >= 2) shape.cooldown -= 1;
  if (P === 'warm_hands' && n.heal) n.heal = Math.round(n.heal * PV.WARM);
  if (P === 'deep_embers' && uses != null) uses += 1;
  // What the town has researched at the Library (the Battlecraft path, lib/research_defs.js): every citizen has it.
  const R = opts.research;
  if (R) {
    if (R.archery_reach && school === 'archery' && shape.max >= 2) shape.max += Math.round(R.archery_reach);
    if (R.heal_uses && n.heal && uses != null) uses += Math.round(R.heal_uses);
    if (R.ward && n.block && (school === 'wild' || school === 'hearth')) n.block = Math.round(n.block * (1 + R.ward));
    if (R.attack && opts.attack && n.dmg) n.dmg = Math.round(n.dmg * (1 + R.attack));
  }
  if (opts.off) for (const k of ['dmg', 'heal', 'block']) if (n[k]) n[k] = Math.max(1, Math.round(n[k] * OFF));
  if (opts.star) for (const k of ['dmg', 'heal', 'block']) if (n[k]) n[k] = Math.round(n[k] * require('./tactics_mastery').EDGE);
  const kind = n.dmg ? 'attack' : n.heal ? 'heal' : n.block ? 'block' : Object.keys(n.fx).some(k => k === 'bold') ? 'buff' : 'debuff';
  return {
    key: kit.key, name: c.name, icon: kit.icon || '•', kind, desc: SAY[kit.key] || c.desc,
    target: TARGET[c.target] || 'enemy', min: shape.min, max: shape.max, shape: kit.shape || 'single', radius: kit.radius || 0,
    dmg: n.dmg || 0, block: n.block || 0, heal: n.heal || 0, fx: n.fx,
    cooldown: shape.cooldown, quick: !!kit.quick, uses,
    falloff: c.hit === 'pierce' ? c.falloff : null,
    ...extra,
    school, ...(opts.off ? { off: true } : {}), ...(opts.star ? { star: true } : {}),
  };
}
// The school of an ability, from the kit it is in: a Guard's are Arms, a villager's two are Basics, a trade's is Fieldcraft.
function schoolOfKey(key) {
  for (const cls of Object.keys(KITS)) if (KITS[cls].abilities.some(k => k.key === key)) return SCHOOL_OF[cls];
  return Object.values(TRADE_KIT).some(k => k.key === key) ? 'field' : 'basics';
}
// What a class has taught by this level, in the order learned. Its Attack is not an ability: it is not here.
const knownAt = (cls, lvl) => (KITS[cls] ? KITS[cls].abilities : []).filter(k => (k.at || 1) <= lvl && !ATTACK_KEYS.has(k.key)).sort((a, b) => (a.at || 1) - (b.at || 1));
// The extra abilities a citizen has learned by study in this class's school (lib/tactics_study.js), as kit entries.
function studied(cls, lessons) {
  if (!lessons || !lessons.size) return [];
  const L = require('./tactics_study').LESSONS;
  return Object.values(L).filter(l => l.kind === 'ability' && l.school === SCHOOL_OF[cls] && lessons.has(l.key)).map(l => ({ ...l.kit, school: l.school, studied: true }));
}
// A class's Attack, as a kit entry.
const KNOCK = { key: 'v_knock', icon: '🥢', min: 1, max: 1 };
function attackKit(cls) {
  const key = ATTACK[KITS[cls] ? cls : 'villager'];
  for (const c of Object.keys(KITS)) { const k = KITS[c].abilities.find(a => a.key === key); if (k) return k; }
  return KNOCK;
}
// The second school: which of an old class's abilities come along. `keys`: the citizen's own choice (up to SECOND);
// with none made, the first SECOND that class taught. → kit entries.
// lessons: what the citizen has learned by study (a Set of keys): that class's extra abilities count among what it taught.
function secondKits(second, cls, lessons) {
  if (!second || !KITS[second.cls] || second.cls === cls || second.cls === 'villager') return [];
  const known = knownAt(second.cls, Math.max(1, Math.floor(Number(second.level)) || 1)).concat(studied(second.cls, lessons));
  const want = Array.isArray(second.keys) ? known.filter(k => second.keys.includes(k.key)) : known;
  return want.slice(0, SECOND);
}
// Which other class a citizen brings abilities from when they have not said: the one they are furthest along in.
// rows: their citizen_classes rows. → { cls, level } or null.
function bestSecond(rows, cls) {
  let best = null;
  for (const k of Object.keys(KITS)) {
    const career = (CC.CLASSES[k] || {}).career;
    if (!career || k === cls) continue;
    const r = (rows || []).find(x => x.class_key === career);
    if (r && (Number(r.level) > 1 || Number(r.xp) > 0) && (!best || Number(r.level) > best.level)) best = { cls: k, level: Number(r.level) || 1 };
  }
  return best;
}

// ── Playtest levels (as the simulators use: scripts/tactics_run_sim.js) ─────
const LEVELS = {
  // cls: the class level that goes with it, which decides how much of the kit is known.
  villager: { label: 'Villager (all stats 8, combat 1, class level 1)',            primary: 8,  secondary: 8,  other: 8, combat: 1, armour: 0, cls: 1 },
  novice:   { label: 'Novice (main stat 10, combat 2, leather, class level 3)',    primary: 10, secondary: 9,  other: 8, combat: 2, armour: 2, cls: 3 },
  trained:  { label: 'Trained (main stat 11, combat 4, leather, class level 6)',   primary: 11, secondary: 10, other: 8, combat: 4, armour: 2, cls: 6 },
  veteran:  { label: 'Veteran (main stat 13, combat 7, chainmail, class level 10)', primary: 13, secondary: 11, other: 8, combat: 7, armour: 4, cls: 10 },
};
const LEVEL_OF_TIER = { green: 'villager', yellow: 'novice', orange: 'trained', red: 'trained', purple: 'veteran' };

// ── Creatures ───────────────────────────────────────────────────────────────
// How much is added to every foe's health and power at each skull (0.3 =
// +30%). These are the defaults; Dev Tools → Life → Dungeons changes them
// live (lib/tuning.js DUNGEON_FOE_*, read by tierNow below). Set for whole runs with
// scripts/tactics_run_sim.js (2026-11-22): the engine's mind, walking the
// careful road through a generated board dungeon with the party a skull
// expects, clears it about nine times in ten, and about seven in ten taking
// every fight. One ordinary fight is 16 to 19 of the player's turns (about
// four minutes at 12 seconds a turn): scripts/tactics_sim.js.
const TIERS = {
  green:  { hp: 0.30, str: 0.05 },
  yellow: { hp: 0.55, str: 0.18 },      // eased 2026-11-22: a party at class level 3 knows three abilities each, not five
  orange: { hp: 1.40, str: 0.60 },
  red:    { hp: 1.50, str: 0.65 },
  purple: { hp: 1.70, str: 0.70 },
};
// A quest's fight (lib/tactics_quests.js) is not a dungeon's: one to four ordinary citizens against one to three
// foes met on the road. 'quest' is its tier. scripts/tactics_quest_sim.js (2026-11-25): with these a lone
// villager wins nearly every fight with one ordinary foe and about three in four with a heavy one.
const QUEST = { hp: 0.30, str: 0.20 };
// The skull's numbers now: what Dev Tools has saved, else the defaults above.
// A script with no database (the sims) reads the defaults, and can change
// TIERS itself.
function tierNow(tier) {
  if (tier === 'quest') {
    if (!process.env.DATABASE_URL) return QUEST;
    try { const TU = require('./tuning'); return { hp: TU.value('QUEST_FOE_HP') ?? QUEST.hp, str: TU.value('QUEST_FOE_POW') ?? QUEST.str }; } catch (e) { return QUEST; }
  }
  const key = TIERS[tier] ? tier : 'green', base = TIERS[key];
  if (!process.env.DATABASE_URL) return base;
  try {
    const TU = require('./tuning'), K = key.toUpperCase();
    return { hp: TU.value('DUNGEON_FOE_HP_' + K) ?? base.hp, str: TU.value('DUNGEON_FOE_POW_' + K) ?? base.str };
  } catch (e) { return base; }
}
// Who the party fights is lib/tactics_foes.js: foes written for the board.
// A creature of the card battles stands in as the foe that took its place
// (FOES.OLD), and one the board has never heard of (made in the enemy editor)
// is read from its row as best it can be, below.
const FOES = require('./tactics_foes');
const CREATURES = {};      // board facts for a creature known only by its row
const BITE = { key: 'bite', name: 'Bite', target: 'enemy', weight: 2, formula: 'damage: strength*0.8 + 2' };
const MOVE_ICON = { attack: '🗡️', debuff: '☠️', buff: '💗', block: '🛡️', special: '💢' };
function creatureUnit(row, i, tier, boost) {
  const T = tierNow(tier), C = CREATURES[row.id] || {};
  const up = (v, by) => Math.max(1, Math.round(v * (1 + by)));
  const stats = { strength: up(row.strength, T.str), agility: row.agility, endurance: row.endurance, intelligence: 5, combatSkill: row.combat_skill, charisma: 5 };
  const moves = (Array.isArray(row.moves) && row.moves.length) ? row.moves : [BITE];
  return {
    id: `e${i}_${row.id}`, key: row.id, name: row.name, icon: row.icon || '👹', cls: 'creature',
    maxHp: up(row.max_hp, T.hp + ((boost && boost.hp) || 0)), armour: 0, agility: row.agility,
    move: C.move || 3, jump: C.jump || 1,
    abilities: moves.map(m => {
      const n = read(m.formula, stats), all = m.target === 'all_enemies', reach = (C.reach || {})[m.key];
      const target = m.target === 'self' ? 'self' : m.target === 'ally' ? 'ally_or_self' : 'enemy';
      return {
        key: m.key, name: m.name, icon: MOVE_ICON[m.intent] || '🗡️', kind: n.dmg ? 'attack' : n.heal ? 'heal' : n.block ? 'block' : 'debuff',
        target, min: target === 'self' ? 0 : (reach ? reach[0] : all ? 0 : 1), max: target === 'self' ? 0 : (reach ? reach[1] : all ? 0 : 1),
        shape: all ? 'around' : 'single', radius: all ? 2 : 0,
        dmg: n.dmg || 0, block: n.block || 0, heal: n.heal || 0, fx: n.fx,
        // A creature's lesser-used move is not ready every turn.
        cooldown: (m.weight || 1) >= 2 ? 0 : 2, quick: false, uses: null, falloff: null,
      };
    }),
  };
}

const TO = { foe: 'enemy', ally: 'ally', allies: 'ally_or_self', self: 'self' };
// A foe of the board (lib/tactics_foes.js) as a unit, at a skull.
function foeUnit(f, i, tier, boost) {
  const T = tierNow(tier);
  const up = (v, by) => Math.max(1, Math.round(v * (1 + by)));
  const stats = { pow: up(f.pow, T.str + ((boost && boost.str) || 0)) };
  return {
    id: `e${i}_${f.key}`, key: f.key, name: f.name, icon: f.icon || '👹', cls: 'creature', band: f.band, rank: f.rank,
    maxHp: up(f.hp, T.hp + ((boost && boost.hp) || 0)), armour: f.armour || 0, agility: f.agi || 6,
    move: f.move || 3, jump: f.jump || 1,
    abilities: f.does.map(d => {
      const n = read(d.formula, stats), target = TO[d.to] || 'enemy', around = d.shape === 'around';
      return {
        key: d.key, name: d.name, icon: d.icon || '🗡️', look: d.look || null,
        kind: n.dmg ? 'attack' : n.heal ? 'heal' : n.block ? 'block' : n.fx.bold ? 'buff' : 'debuff',
        target, min: target === 'self' || around ? 0 : (d.min || 0), max: target === 'self' || around ? 0 : (d.max || 0),
        shape: d.shape || 'single', radius: d.radius || 0,
        dmg: n.dmg || 0, block: n.block || 0, heal: n.heal || 0, fx: n.fx,
        cooldown: d.cd || 0, quick: false, uses: null, falloff: null,
      };
    }),
  };
}

// ── The party ───────────────────────────────────────────────────────────────
const E = () => require('./citizen_unit');
// classLevel: the citizen's level in this class (lib/careers), which decides what they have learned.
// Which of the abilities a citizen knows go into a battle: the ones they have
// readied at home, in the kit's order; with nothing chosen (or a choice that
// no longer fits), the first READY they learned. → the kit entries.
function readied(known, ready) {
  if (known.length <= READY) return known;
  const want = Array.isArray(ready) ? known.filter(k => ready.includes(k.key)).slice(0, READY) : [];
  for (const k of known.slice().sort((x, y) => (x.at || 1) - (y.at || 1))) { if (want.length >= READY) break; if (!want.includes(k)) want.push(k); }
  return known.filter(k => want.includes(k));
}
const brief = k => ({ key: k.key, name: CC.ability(k.key).name, icon: k.icon || '•', at: k.at });
// second: { cls, level, keys } — the other class this citizen brings abilities from (their second school), or null.
// stars: a Set of the ability keys this citizen has mastered (lib/tactics_mastery.js), or null.
// more: { lessons: a Set of what they have learned by study, passive: the passive in their slot } (lib/tactics_study.js),
//       research: the town's battle research (researchOf), signature: { key, from_name }, the ability a parent taught them,
//       and lore: { key, from }, the ability an Allied village taught them.
function partyUnit(c, cls, level, trade, classLevel, second, stars, more) {
  const lessons = (more && more.lessons) || null, passive = (more && more.passive) || null;
  const star = k => !!(stars && stars.has(k.key));
  const research = (more && more.research) || null;
  const of = (k, x) => abilityOf(k, unit, { star: star(k), passive, research, school: k.school, ...(x || {}) });
  const kit = KITS[cls] || KITS.villager, pack = CC.CLASSES[cls] || CC.CLASSES.villager;
  let unit;
  if (level && LEVELS[level]) {
    const L = LEVELS[level];
    const career = pack.career ? (require('./careers/classes').CLASSES[pack.career] || {}) : {};
    const stats = { strength: L.other, agility: L.other, endurance: L.other, intelligence: L.other, charisma: L.other };
    if (career.primary) stats[career.primary] = L.primary;
    if (career.secondary) stats[career.secondary] = L.secondary;
    unit = E().unitFromCitizen({ id: c.id, name: c.name, role: c.role, stats, skills: { combat: L.combat }, armour: L.armour });
    unit.charisma = stats.charisma;
  } else unit = c.unit;
  const lvl = Math.max(1, Math.floor(Number(level && LEVELS[level] ? LEVELS[level].cls : classLevel)) || 1);
  const mine = KITS[cls] ? cls : 'villager', villager = mine === 'villager';
  // Their Attack, then everything the class has taught so far; a villager adds their trade's trick.
  const own = knownAt(mine, lvl).concat(studied(mine, lessons)), extra = villager ? [TRADE_KIT[trade] || TRADE_KIT.t_tool] : [];
  const others = secondKits(second, mine, lessons);
  // The family's signature (lib/tactics_signature.js): one ability a parent taught them, at full strength
  // whatever class they are. Nothing extra when their own class has already taught it.
  const sigKey = more && more.signature && more.signature.key, sigKit = sigKey ? require('./tactics_signature').kitOf(sigKey) : null;
  const sig = sigKit && !own.some(k => k.key === sigKey) ? sigKit : null;
  // Village lore (lib/tactics_lore.js): the one ability an Allied village taught them, at full strength.
  const loreKit = more && more.lore && more.lore.key ? require('./tactics_lore').kitOf(more.lore.key) : null;
  const pInfo = passive ? require('./tactics_study').LESSONS[passive] : null;
  const ahead = kit.abilities.filter(k => (k.at || 1) > lvl && !ATTACK_KEYS.has(k.key)).sort((a, b) => a.at - b.at);
  return {
    id: 'c' + c.id, citizen_id: c.id, name: c.name, cls: KITS[cls] ? cls : 'villager', label: pack.label, icon: pack.icon,
    maxHp: unit.maxHp, armour: Number(unit.armour) || 0, agility: unit.agility, move: GEAR.moveWith(kit.move, GEAR.describe(unit.gear)) + (passive === 'light_feet' ? 1 : 0), jump: kit.jump + (passive === 'sure_footed' ? 1 : 0),
    // What they hold and wear: the kind of weapon shapes their abilities (lib/gear_kinds.js); kept on the unit so the board can draw it one day.
    gear: GEAR.describe(unit.gear),
    stats: { strength: unit.strength, agility: unit.agility, endurance: unit.endurance, intelligence: unit.intelligence, charisma: unit.charisma, combat: unit.combatSkill },
    // What they carry that has dice of its own, and what it adds to each blow (weaponEdge).
    weapon: unit.weapon && weaponEdge(unit.weapon) ? { name: unit.weapon.name || 'Weapon', edge: weaponEdge(unit.weapon) } : null,
    // The Attack first (marked: the screen gives it a button of its own), then the class's own school, then
    // what comes from the second school at OFF strength.
    abilities: [{ ...of(attackKit(mine), { attack: true }), attack: true }]
      .concat(own.map(k => of(k)), sig ? [{ ...of(sig), signature: true, ...(more.signature.from_name ? { taught_by: more.signature.from_name } : {}) }] : [],
        loreKit ? [{ ...of(loreKit), lore: true, ...(more.lore.from ? { taught_by: more.lore.from } : {}) }] : [], extra.map(k => of(k)),
        others.filter(k => !(sig && k.key === sigKey)).map(k => of(k, { off: true }))),
    // The passive in their slot: Brace and Counter are the board's own rules (the engine reads `passive`);
    // the others have already changed the unit and its abilities above.
    ...(pInfo ? { passive, passive_info: { key: passive, name: pInfo.name, icon: pInfo.icon, says: pInfo.says } } : {}),
    school: SCHOOL_OF[mine],
    second: others.length ? { cls: second.cls, school: SCHOOL_OF[second.cls], label: (CC.CLASSES[second.cls] || {}).label, level: Math.max(1, Math.floor(Number(second.level)) || 1) } : null,
    // The ladder: their class level and the next ability it will teach. (locked, spare: from when a citizen
    // brought five; kept empty for screens that still read them.)
    class_level: lvl,
    locked: [],
    next: ahead.length ? brief(ahead[0]) : null,
    spare: 0,
  };
}
// What a class learns on the way from one level to another: [{ key, name, icon, at }].
function learnedBetween(cls, from, to) {
  const kit = KITS[cls];
  if (!kit) return [];
  const ladder = kit.abilities.slice().sort((a, b) => (a.at || 1) - (b.at || 1));
  // (spare: false — everything a class teaches comes to the next battle, since 2026-11-26.)
  return ladder.filter(k => (k.at || 1) > from && (k.at || 1) <= to && !ATTACK_KEYS.has(k.key)).map(k => ({ ...brief(k), spare: false }));
}

// The town's battle research, from its finished Library projects: { archery_reach, heal_uses, ward, attack } (only
// those it has), or null. sid: the settlement.
async function researchOf(sid) {
  if (!sid) return null;
  const all = await require('./research').effectsFor(null, sid).catch(() => ({})), out = {};
  for (const k of Object.keys(all)) if (k.startsWith('battle:') && all[k]) out[k.slice(7)] = all[k];
  return Object.keys(out).length ? out : null;
}
// A citizen's second school as partyUnit wants it. rows: their citizen_classes rows; pick: { second_class, second_ready }.
// What they chose, if they still have levels in it; else the class they are furthest along in.
function secondOf(rows, cls, pick) {
  const level = k => { const r = (rows || []).find(x => x.class_key === (CC.CLASSES[k] || {}).career); return r && (Number(r.level) > 1 || Number(r.xp) > 0) ? Number(r.level) || 1 : 0; };
  const chosen = pick && pick.second_class;
  if (chosen === 'none') return null;
  if (chosen && KITS[chosen] && chosen !== cls && chosen !== 'villager' && level(chosen)) return { cls: chosen, level: level(chosen), keys: Array.isArray(pick.second_ready) ? pick.second_ready : null };
  const best = bestSecond(rows, cls);
  return best ? { ...best, keys: null } : null;
}

// The party's units, in the order given (the first two stand in front).
//   classes: a class for each (else their own); level: a LEVELS key (else as they are);
//   mods: frozen career changes, as a card battle takes them; start: { id: { hp } | { down: true } }
//   carried in from a dungeon run: a citizen who is down lies on the board until someone heals them.
async function partyFor(ids, { classes = [], level = null, mods = null, start = null } = {}) {
  const real = await require('./combat_resolver').partyUnits(ids, mods);
  const levels = (await query('SELECT citizen_id, class_key, level, xp FROM citizen_classes WHERE citizen_id = ANY($1::int[])', [ids]).catch(() => ({ rows: [] }))).rows;
  // Each citizen's second school: the class they chose to bring abilities from, and which (citizens.second_class, second_ready).
  const picks = (await query('SELECT id, second_class, second_ready FROM citizens WHERE id = ANY($1::int[])', [ids]).catch(() => ({ rows: [] }))).rows;
  // What each has mastered: those abilities are a fifth stronger in their hands (lib/tactics_mastery.js).
  const stars = level ? new Map() : await require('./tactics_mastery').starsFor(ids);
  // What each has learned by study, and the passive in their slot (lib/tactics_study.js).
  const STUDY = require('./tactics_study'), lessons = level ? new Map() : await STUDY.lessonsFor(ids), passives = level ? new Map() : await STUDY.passiveFor(ids);
  // What their town has researched for battle (the Library's Battlecraft path).
  const home = level || !ids.length ? null : (await query('SELECT settlement_id FROM citizens WHERE id=$1', [ids[0]]).catch(() => ({ rows: [] }))).rows[0];
  const research = home ? await researchOf(home.settlement_id) : null;
  const sigs = level ? new Map() : await require('./tactics_signature').forCitizens(ids);
  const lores = level ? new Map() : await require('./tactics_lore').forCitizens(ids);
  const out = [];
  ids.forEach((id, i) => {
    const c = real.find(x => x.id === id), st = start && (start[id] || start[String(id)]);
    if (!c) return;
    const own = CC.classFor(c);
    const cls = KITS[classes[i]] ? classes[i] : own.cls, career = (CC.CLASSES[cls] || {}).career;
    const rows = levels.filter(r => r.citizen_id === c.id), mine = rows.find(r => r.class_key === career) || {};
    // A practice battle at a set level, or in a borrowed class, has no second school.
    const second = level || KITS[classes[i]] ? null : secondOf(rows, KITS[cls] ? cls : 'villager', picks.find(p => p.id === c.id));
    const u = partyUnit(c, cls, level, own.trade, mine.level || 1, second, stars.get(c.id) || null, { lessons: lessons.get(c.id) || null, passive: passives.get(c.id) || null, research, signature: sigs.get(c.id) || null, lore: lores.get(c.id) || null });
    // Whoever is down is brought along and lies at their place until healed (the engine's "Fallen" rule).
    if (st && st.down) { u.down = true; u.hp = 0; }
    else if (st && st.hp != null) u.hp = Math.max(1, Math.min(u.maxHp, Math.round(Number(st.hp)) || 1));
    out.push(u);
  });
  return out;
}
// The foes of a room: their keys, the skull, and the room's own boost.
async function foesFor(keys, tier, boost, run) {
  const unknown = keys.filter(k => !FOES.foe(k));
  const rows = unknown.length ? (await (run || query)('SELECT * FROM enemy_definitions WHERE id = ANY($1::text[])', [unknown])).rows : [];
  return keys.map((k, i) => {
    const f = FOES.foe(k);
    if (f) return foeUnit(f, i, tier, boost);
    const row = rows.find(x => x.id === k);
    if (!row) throw err(500, `No such creature: ${k}.`);
    return creatureUnit(row, i, tier, boost);
  });
}
// What a fight's foes are worth in wealth, before the skull's share: 8 for each point of reward.
async function rewardOf(keys, run) {
  const unknown = keys.filter(k => !FOES.foe(k));
  const rows = unknown.length ? (await (run || query)('SELECT id, reward_weight FROM enemy_definitions WHERE id = ANY($1::text[])', [unknown])).rows : [];
  return keys.reduce((n, k) => n + ((FOES.foe(k) || {}).reward || (rows.find(w => w.id === k) || {}).reward_weight || 1) * 8, 0);
}
// What the foes of a won fight left behind (FOES.dropsOf), keeping only items
// this database has, so nothing found is missing when it is paid.
async function dropsFor(keys, seed, run) {
  const q = run || query, unknown = keys.filter(k => !FOES.foe(k));
  const rows = unknown.length ? (await q('SELECT id, drops FROM enemy_definitions WHERE id = ANY($1::text[])', [unknown])).rows : [];
  const extra = {};
  for (const r of rows) extra[r.id] = Array.isArray(r.drops) ? r.drops : [];
  const got = FOES.dropsOf(keys, seed, extra);
  if (!got.length) return [];
  const real = new Set((await q('SELECT item_key FROM item_templates WHERE item_key = ANY($1::text[])', [got.map(g => g.item)])).rows.map(r => r.item_key));
  return got.filter(g => real.has(g.item));
}
// Names and icons for a list of keys, as the dungeon's screen shows a room.
const facesOf = keys => keys.map(k => FOES.foe(k)).filter(Boolean).map(f => ({ id: f.key, name: f.name, icon: f.icon }));
const speciesOf = async (userId, run) => ((await (run || query)('SELECT species FROM users WHERE id=$1', [userId]).catch(() => ({ rows: [] }))).rows[0] || {}).species || null;

// opts: { classes: [cls ×4], level: 'as_is' | a LEVELS key | 'skull', tier, terrain, seed, fight: 'first' | 'hard' | 'boss', citizen_ids }
async function build(userId, opts = {}) {
  const DEFS = require('./dungeon_defs'), GEN = require('./dungeon_gen'), D = require('./dungeons');
  const tier = DEFS.TIERS[opts.tier] ? opts.tier : 'green';
  const terrain = GEN.LANDS.includes(opts.terrain) ? opts.terrain : 'forest';
  const seed = Math.max(1, Math.min(0x7ffffffe, Math.floor(Number(opts.seed)) || (Math.floor(Math.random() * 0x7ffffffe) + 1)));
  const s = (await query('SELECT * FROM settlements WHERE user_id=$1', [userId])).rows[0];
  if (!s) throw err(404, 'No settlement.');
  // Four adults: those named, else the first four who are free, else any four grown-ups (a battle here keeps nobody busy).
  let ids = Array.isArray(opts.citizen_ids) ? opts.citizen_ids.map(Number).filter(Boolean).slice(0, 4) : [];
  if (ids.length < 4) ids = await D.freeAdults(s);
  if (ids.length < 4) ids = (await query(`SELECT id FROM citizens WHERE settlement_id=$1 AND COALESCE(life_stage,'adult') IN ('adult','elder') ORDER BY id LIMIT 4`, [s.id])).rows.map(r => r.id);
  if (ids.length < 4) throw err(400, 'A battle takes four grown-up citizens, and this town has fewer.');
  const level = opts.level === 'skull' ? LEVEL_OF_TIER[tier] : (LEVELS[opts.level] ? opts.level : null);
  // "As they are" means with their careers' perks and what they hold and wear, as a dungeon would have them.
  const CRs = require('./combat_resolver'), mods = level ? null : CRs.withParty(null, await require('./careers').combatDeltas(s.id, ids).catch(() => ({})));
  const party = await partyFor(ids, { classes: Array.isArray(opts.classes) ? opts.classes : [], level, mods });
  // The foes: a band's showcase when one is asked for, else a fight from a
  // dungeon the generator makes for this skull, land and seed.
  let room, name, band = FOES.BANDS[opts.band] ? opts.band : null;
  const kind = ['first', 'hard', 'boss'].includes(opts.fight) ? opts.fight : 'first';
  if (band) {
    room = { type: kind === 'boss' ? 'boss' : kind === 'hard' ? 'elite' : 'fight', enemies: FOES.SHOWCASE[band][kind] };
    name = FOES.BANDS[band].name;
  } else {
    const cast = FOES.castFor(terrain, seed);
    band = cast.band;
    const made = GEN.generate({ seed, tier, terrain, creatures: cast.creatures, items: [] });
    const fights = made.floors.reduce((all, f) => all.concat(f.rooms.filter(r => Array.isArray(r.enemies) && r.enemies.length)), []);
    const size = r => r.enemies.reduce((n, k) => n + ((FOES.foe(k) || {}).hp || 0), 0) * (1 + ((r.boost && r.boost.hp) || 0));
    room = kind === 'boss' ? (fights.find(r => r.type === 'boss') || fights[fights.length - 1])
      : kind === 'hard' ? fights.filter(r => r.type !== 'boss').sort((a, b) => size(b) - size(a))[0]
      : fights[0];
    name = made.name;
  }
  if (!room) throw err(500, 'The generator made no fight.');
  const enemies = await foesFor(room.enemies, tier, room.boost);
  const made = { name };
  return { ok: true, seed, land: terrain, tier, skull: DEFS.TIERS[tier].skull, name: made.name, band, fight: room.type, level: level || 'as_is', species: await speciesOf(userId), party, enemies };
}

module.exports = { KITS, TRADE_KIT, SAY, READY, SCHOOLS, SCHOOL_OF, ATTACK, attackKit, studied, researchOf, SECOND, OFF, knownAt, secondKits, secondOf, bestSecond, schoolOfKey, readied, weaponEdge, TIERS, QUEST, tierNow, LEVELS, LEVEL_OF_TIER, CREATURES, FOES, calc, read, abilityOf, creatureUnit, foeUnit, partyUnit, partyFor, learnedBetween, foesFor, rewardOf, dropsFor, facesOf, speciesOf, build };
