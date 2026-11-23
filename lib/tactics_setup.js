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
//    build(userId, opts) → { seed, land, tier, name, band, party, enemies }
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
// at: the class level at which it is learned (the ladder, docs/TACTICS.md §6):
// two to begin with, then one each at levels 2, 4 and 6. A villager's are all
// known from the start.
const A = (key, x) => ({ key, ...x });
const KITS = {
  guard: { move: 3, jump: 1, abilities: [
    A('g_strike', { at: 1, icon: '⚔️', min: 1, max: 1 }),
    A('g_shield', { at: 1, icon: '🛡️', max: 0, cooldown: 1 }),
    A('g_cover',  { at: 2, icon: '🤝', min: 1, max: 2, cooldown: 1 }),
    A('g_shove',  { at: 4, icon: '💨', min: 1, max: 1, cooldown: 2 }),
    A('g_heavy',  { at: 6, icon: '🔨', min: 1, max: 1, cooldown: 3 }),
  ] },
  archer: { move: 3, jump: 2, abilities: [
    A('a_shoot',  { at: 1, icon: '🏹', min: 2, max: 5 }),
    A('a_side',   { at: 1, icon: '🌀', max: 0, cooldown: 1 }),
    A('a_part',   { at: 2, icon: '↩️', min: 1, max: 3, cooldown: 2 }),
    A('a_pierce', { at: 6, icon: '➶', min: 1, max: 5, shape: 'line', cooldown: 3 }),
    A('a_mark',   { at: 4, icon: '🎯', min: 1, max: 5, quick: true, cooldown: 2 }),
  ] },
  wizard: { move: 3, jump: 1, abilities: [
    A('w_spark',  { at: 1, icon: '✨', min: 1, max: 4 }),
    A('w_ward',   { at: 1, icon: '🔰', min: 0, max: 3, cooldown: 1 }),
    A('w_bolt',   { at: 2, icon: '🔥', min: 1, max: 4, cooldown: 1 }),
    A('w_burst',  { at: 6, icon: '💥', min: 1, max: 4, shape: 'burst', radius: 1, cooldown: 3 }),
    A('w_chill',  { at: 4, icon: '❄️', min: 1, max: 4, cooldown: 2 }),
  ] },
  hearthkeeper: { move: 3, jump: 1, abilities: [
    A('h_cinder', { at: 1, icon: '🔥', min: 1, max: 3 }),
    A('h_ward',   { at: 2, icon: '🔰', min: 0, max: 3, cooldown: 1 }),
    A('h_kindle', { at: 1, icon: '💗', min: 0, max: 3, uses: 2 }),      // a Hearthkeeper heals from their first day: it is what the class is
    A('h_steady', { at: 6, icon: '🕊️', shape: 'around', radius: 2, cooldown: 2 }),
    A('h_bold',   { at: 4, icon: '📣', min: 1, max: 3, quick: true, cooldown: 2 }),
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
// The skull's numbers now: what Dev Tools has saved, else the defaults above.
// A script with no database (the sims) reads the defaults, and can change
// TIERS itself.
function tierNow(tier) {
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
const E = () => require('./combat_engine');
// classLevel: the citizen's level in this class (lib/careers), which decides what they have learned.
function partyUnit(c, cls, level, trade, classLevel) {
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
  const lvl = Math.max(1, Math.floor(Number(level && LEVELS[level] ? LEVELS[level].cls : classLevel)) || 1);
  const all = kit.abilities.concat(cls === 'villager' || !KITS[cls] ? [TRADE_KIT[trade] || TRADE_KIT.t_tool] : []);
  const kits = all.filter(k => (k.at || 1) <= lvl);
  return {
    id: 'c' + c.id, citizen_id: c.id, name: c.name, cls: KITS[cls] ? cls : 'villager', label: pack.label, icon: pack.icon,
    maxHp: unit.maxHp, armour: Number(unit.armour) || 0, agility: unit.agility, move: kit.move, jump: kit.jump,
    stats: { strength: unit.strength, agility: unit.agility, endurance: unit.endurance, intelligence: unit.intelligence, charisma: unit.charisma, combat: unit.combatSkill },
    abilities: kits.map(k => abilityOf(k, unit)),
    // The ladder: their class level, and what they have yet to learn, for the screen to show.
    class_level: lvl,
    locked: all.filter(k => (k.at || 1) > lvl).sort((a, b) => a.at - b.at).map(k => ({ key: k.key, name: CC.card(k.key).name, icon: k.icon || '•', at: k.at })),
  };
}
// What a class learns on the way from one level to another: [{ key, name, icon, at }].
function learnedBetween(cls, from, to) {
  const kit = KITS[cls];
  return kit ? kit.abilities.filter(k => (k.at || 1) > from && (k.at || 1) <= to).sort((a, b) => a.at - b.at).map(k => ({ key: k.key, name: CC.card(k.key).name, icon: k.icon || '•', at: k.at })) : [];
}

// The party's units, in the order given (the first two stand in front).
//   classes: a class for each (else their own); level: a LEVELS key (else as they are);
//   mods: frozen career changes, as a card battle takes them; start: { id: { hp } | { down: true } }
//   carried in from a dungeon run: a citizen who is down lies on the board until someone heals them.
async function partyFor(ids, { classes = [], level = null, mods = null, start = null } = {}) {
  const real = await require('./combat_resolver').partyUnits(ids, mods);
  const levels = (await query('SELECT citizen_id, class_key, level FROM citizen_classes WHERE citizen_id = ANY($1::int[])', [ids]).catch(() => ({ rows: [] }))).rows;
  const out = [];
  ids.forEach((id, i) => {
    const c = real.find(x => x.id === id), st = start && (start[id] || start[String(id)]);
    if (!c) return;
    const own = CC.packFor(c);
    const cls = KITS[classes[i]] ? classes[i] : own.cls, career = (CC.PACKS[cls] || {}).career;
    const u = partyUnit(c, cls, level, own.trade, (levels.find(r => r.citizen_id === c.id && r.class_key === career) || {}).level || 1);
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
  const party = await partyFor(ids, { classes: Array.isArray(opts.classes) ? opts.classes : [], level });
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

module.exports = { KITS, TRADE_KIT, TIERS, tierNow, LEVELS, LEVEL_OF_TIER, CREATURES, FOES, calc, read, abilityOf, creatureUnit, foeUnit, partyUnit, partyFor, learnedBetween, foesFor, rewardOf, dropsFor, facesOf, speciesOf, build };
