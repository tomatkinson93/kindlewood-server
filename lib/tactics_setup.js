// ══════════════════════════════════════════════════════════════════════════
//  tactics_setup — the two sides of a tactics battle (a prototype:
//  docs/TACTICS.md). The battle itself is played in the browser by
//  the frontend's js/tactics-engine.js; this file turns citizens and
//  creatures into the units that engine takes. Nothing is stored and nothing
//  is paid: a battle here costs and gives nothing.
//
//  What carries over from the class decks: every ability is a class card
//  (lib/class_cards.js) and takes its numbers from that card's formula, read
//  with the citizen's own stats. This file only adds what a board needs:
//  how far it reaches, its shape, and how often it can be used.
//
//    KITS            class → { move, jump, abilities: [card key + board facts] }
//    TIERS           creature health and strength per skull, for tactics
//    LEVELS          the playtest levels (villager, novice, trained, veteran)
//    build(userId, opts) → { seed, land, tier, name, party, enemies }
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const { query } = require('../db');
const CC = require('./class_cards');
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
const A = (key, x) => ({ key, ...x });
const KITS = {
  guard: { move: 3, jump: 1, abilities: [
    A('g_strike', { icon: '⚔️', min: 1, max: 1 }),
    A('g_shield', { icon: '🛡️', max: 0, cooldown: 1 }),
    A('g_cover',  { icon: '🤝', min: 1, max: 2, cooldown: 1 }),
    A('g_shove',  { icon: '💨', min: 1, max: 1, cooldown: 2 }),
    A('g_heavy',  { icon: '🔨', min: 1, max: 1, cooldown: 3 }),
  ] },
  archer: { move: 3, jump: 2, abilities: [
    A('a_shoot',  { icon: '🏹', min: 2, max: 5 }),
    A('a_side',   { icon: '🌀', max: 0, cooldown: 1 }),
    A('a_part',   { icon: '↩️', min: 1, max: 3, cooldown: 2 }),
    A('a_pierce', { icon: '➶', min: 1, max: 5, shape: 'line', cooldown: 3 }),
    A('a_mark',   { icon: '🎯', min: 1, max: 5, quick: true, cooldown: 2 }),
  ] },
  wizard: { move: 3, jump: 1, abilities: [
    A('w_spark',  { icon: '✨', min: 1, max: 4 }),
    A('w_ward',   { icon: '🔰', min: 0, max: 3, cooldown: 1 }),
    A('w_bolt',   { icon: '🔥', min: 1, max: 4, cooldown: 1 }),
    A('w_burst',  { icon: '💥', min: 1, max: 4, shape: 'burst', radius: 1, cooldown: 3 }),
    A('w_chill',  { icon: '❄️', min: 1, max: 4, cooldown: 2 }),
  ] },
  hearthkeeper: { move: 3, jump: 1, abilities: [
    A('h_cinder', { icon: '🔥', min: 1, max: 3 }),
    A('h_ward',   { icon: '🔰', min: 0, max: 3, cooldown: 1 }),
    A('h_kindle', { icon: '💗', min: 0, max: 3, uses: 2 }),
    A('h_steady', { icon: '🕊️', shape: 'around', radius: 2, cooldown: 2 }),
    A('h_bold',   { icon: '📣', min: 1, max: 3, quick: true, cooldown: 2 }),
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
const TARGET = { enemy: 'enemy', all_enemies: 'enemy', ally: 'ally', all_allies: 'ally_or_self', ally_or_self: 'ally_or_self', self: 'self' };
function abilityOf(kit, stats) {
  const c = CC.card(kit.key);
  const n = read(c.formula, stats);
  const kind = n.dmg ? 'attack' : n.heal ? 'heal' : n.block ? 'block' : Object.keys(n.fx).some(k => k === 'bold') ? 'buff' : 'debuff';
  return {
    key: kit.key, name: c.name, icon: kit.icon || '•', kind, desc: c.desc,
    target: TARGET[c.target] || 'enemy', min: kit.min || 0, max: kit.max || 0, shape: kit.shape || 'single', radius: kit.radius || 0,
    dmg: n.dmg || 0, block: n.block || 0, heal: n.heal || 0, fx: n.fx,
    cooldown: kit.cooldown || 0, quick: !!kit.quick, uses: kit.uses != null ? kit.uses : null,
    falloff: c.hit === 'pierce' ? c.falloff : null,
  };
}

// ── Playtest levels (the simulator's, scripts/dungeon_balance_sim.js) ───────
const LEVELS = {
  villager: { label: 'Villager (all stats 8, combat 1)',            primary: 8,  secondary: 8,  other: 8, combat: 1, armour: 0 },
  novice:   { label: 'Novice (main stat 10, combat 2, leather)',    primary: 10, secondary: 9,  other: 8, combat: 2, armour: 2 },
  trained:  { label: 'Trained (main stat 11, combat 4, leather)',   primary: 11, secondary: 10, other: 8, combat: 4, armour: 2 },
  veteran:  { label: 'Veteran (main stat 13, combat 7, chainmail)', primary: 13, secondary: 11, other: 8, combat: 7, armour: 4 },
};
const LEVEL_OF_TIER = { green: 'villager', yellow: 'novice', orange: 'trained', red: 'trained', purple: 'veteran' };

// ── Creatures ───────────────────────────────────────────────────────────────
// A board battle is not a card battle, so these are not the card skulls'
// numbers (lib/dungeon_defs.js). First values, from scripts/tactics_sim.js:
// an ordinary fight takes the bot 17 to 20 of the player's turns (about four
// minutes at 12 seconds a turn) and costs the party a quarter to a third of
// its health. To be tuned by play, and for whole runs, if this is kept.
const TIERS = {
  green:  { hp: 0.40, str: 0.10 },
  yellow: { hp: 0.80, str: 0.30 },
  orange: { hp: 1.40, str: 0.60 },
  red:    { hp: 1.80, str: 0.80 },
  purple: { hp: 2.40, str: 1.00 },
};
// What a board needs to know of each creature and that its row does not say.
// reach: move key → [min, max]. Anything not listed is a melee blow.
const CREATURES = {
  marsh_rat:      { move: 4 },
  river_pike:     { move: 3 },
  wild_fox:       { move: 4 },
  rot_shaman:     { move: 3, reach: { hex: [1, 4], mend: [1, 3] } },
  mountain_harpy: { move: 5, jump: 3 },
  bog_lurker:     { move: 3, reach: { venom: [2, 3] } },
  night_wolf:     { move: 4 },
  withered_husk:  { move: 2 },
  fungal_toad:    { move: 2, jump: 2 },
  thornback_boar: { move: 3 },
  hill_ogre:      { move: 2 },
};
const BITE = { key: 'bite', name: 'Bite', target: 'enemy', weight: 2, formula: 'damage: strength*0.8 + 2' };
const MOVE_ICON = { attack: '🗡️', debuff: '☠️', buff: '💗', block: '🛡️', special: '💢' };
function creatureUnit(row, i, tier, boost) {
  const T = TIERS[tier] || TIERS.green, C = CREATURES[row.id] || {};
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

// ── The party ───────────────────────────────────────────────────────────────
const E = () => require('./combat_engine');
function partyUnit(c, cls, level, trade) {
  const kit = KITS[cls] || KITS.villager, pack = CC.PACKS[cls] || CC.PACKS.villager;
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
  const kits = kit.abilities.concat(cls === 'villager' || !KITS[cls] ? [TRADE_KIT[trade] || TRADE_KIT.t_tool] : []);
  return {
    id: 'c' + c.id, citizen_id: c.id, name: c.name, cls: KITS[cls] ? cls : 'villager', label: pack.label, icon: pack.icon,
    maxHp: unit.maxHp, armour: Number(unit.armour) || 0, agility: unit.agility, move: kit.move, jump: kit.jump,
    stats: { strength: unit.strength, agility: unit.agility, endurance: unit.endurance, intelligence: unit.intelligence, charisma: unit.charisma, combat: unit.combatSkill },
    abilities: kits.map(k => abilityOf(k, unit)),
  };
}

// opts: { classes: [cls ×4], level: 'as_is' | a LEVELS key | 'skull', tier, terrain, seed, fight: 'first' | 'hard' | 'boss', citizen_ids }
async function build(userId, opts = {}) {
  const DEFS = require('./dungeon_defs'), GEN = require('./dungeon_gen'), D = require('./dungeons'), R = require('./combat_resolver');
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
  const real = await R.partyUnits(ids, null);
  const level = opts.level === 'skull' ? LEVEL_OF_TIER[tier] : (LEVELS[opts.level] ? opts.level : null);
  const classes = Array.isArray(opts.classes) ? opts.classes : [];
  const party = ids.map((id, i) => {
    const c = real.find(x => x.id === id);
    const own = CC.packFor(c);
    const cls = KITS[classes[i]] ? classes[i] : own.cls;
    return partyUnit(c, cls, level, own.trade);
  });
  // The creatures: a fight from a dungeon the generator makes for this skull, land and seed.
  const rows = (await query('SELECT * FROM enemy_definitions WHERE archived = FALSE')).rows;
  const made = GEN.generate({ seed, tier, terrain, creatures: rows.map(r => ({ id: r.id, name: r.name, max_hp: r.max_hp, biomes: r.biomes, archived: r.archived })), items: [] });
  const fights = made.floors.reduce((all, f) => all.concat(f.rooms.filter(r => Array.isArray(r.enemies) && r.enemies.length)), []);
  const size = r => r.enemies.reduce((n, k) => n + ((rows.find(x => x.id === k) || {}).max_hp || 0), 0) * (1 + ((r.boost && r.boost.hp) || 0));
  const room = opts.fight === 'boss' ? (fights.find(r => r.type === 'boss') || fights[fights.length - 1])
    : opts.fight === 'hard' ? fights.filter(r => r.type !== 'boss').sort((a, b) => size(b) - size(a))[0]
    : fights[0];
  if (!room) throw err(500, 'The generator made no fight.');
  const enemies = room.enemies.map((k, i) => creatureUnit(rows.find(x => x.id === k), i, tier, room.boost));
  return { ok: true, seed, land: terrain, tier, skull: DEFS.TIERS[tier].skull, name: made.name, fight: room.type, level: level || 'as_is', species: s.species || null, party, enemies };
}

module.exports = { KITS, TRADE_KIT, TIERS, LEVELS, LEVEL_OF_TIER, CREATURES, calc, read, abilityOf, creatureUnit, partyUnit, build };
