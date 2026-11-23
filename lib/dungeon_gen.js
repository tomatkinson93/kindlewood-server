// ══════════════════════════════════════════════════════════════════════════
//  dungeon_gen — a dungeon from a seed (docs/DUNGEONS.md §4, §5.1, §5.3;
//  build step 3).
//
//    generate({ seed, tier, terrain, creatures, items }) → a story, the same shape
//      as the hand-written ones in lib/dungeon_defs.js: { name, tier,
//      terrain, intro, boss, floors: [{ rooms }], clear, generated: true }
//
//  Pure: no database, no clock, no Math.random. The same seed, skull, land
//  and creature list always give the same dungeon, so every town sees the
//  same one. The caller stores the result on the dungeon row (`layout`), so a
//  later change to the creature list cannot change a dungeon that is already
//  on the map.
//
//  Every fight is a battle on the board (docs/TACTICS.md), which takes four
//  or five minutes, so a dungeon has few fights and a route through one,
//  boss and all, meets
//    green 2 to 3 · yellow 3 to 4 · orange 3 to 5 · red 4 to 6 · purple 5 to 7
//  (scripts/tactics_run_sim.js, 2026-11-22). The longer shapes written for
//  the card battles (DUNGEON_CONTENT.md §6.1) were retired with them on
//  2026-11-23; treasure and the boss chest are as they were.
//
//  What it builds, per skull (SHAPES below):
//    - floors of 3 lanes by N steps: one fight at the door, 2 or 3 rooms at
//      every step between, and one last room (a landing, or the boss on the
//      deepest floor). Each room links to 1 or 2 rooms in the next step, and
//      links never cross.
//    - room types that obey the path rules (dungeon_defs.checkFloor) and the
//      route rules (checkRoutes below): every way through a floor has a rest,
//      a sensible number of fights, never a third fight in a row without a
//      way round it, and never a string of treasure rooms.
//    - elites as a choice: an elite room always stands beside another way on.
//    - creature groups from the land's creatures, harder the deeper the room.
//    - treasure, an elite's find and the boss chest from the land's materials.
//
//  Not yet: event rooms (build step 6). Until they exist, the rooms that
//  will be events are treasure. Real elites and bosses (build step 8): until
//  a land has a creature of that rank, its strongest creature stands in,
//  with a boost to the room's skull numbers (`standin: true`).
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const DEFS = require('./dungeon_defs');

// ── Seeded randomness ───────────────────────────────────────────────────────
function hash(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// A stream of its own for each purpose, so what lives in a room does not
// depend on how many tries the layout took.
const stream = (seed, label) => mulberry32(hash(`${seed}|${label}`));
const pick = (rnd, list) => list[Math.floor(rnd() * list.length)];
const between = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

// ── The shape of each skull ─────────────────────────────────────────────────
//   steps    [fewest, most] steps on a floor
//   fights   [fewest, most] fights a way through each floor may meet, the
//            door's fight included, the boss and optional elites not
//   elites   elite rooms in the whole dungeon
//   groups   creature groups from easy to hard: M minion, R regular, H heavy
//   elite / boss   groups for those rooms (E elite, B boss)
//   room     what one treasure room is worth; elite: what an elite's find is
//   chest    the clear reward (boss chest), on top of the boss fight's own;
//            from yellow up it also holds a piece of gear (GEAR below)
const SHAPES = {
  green:  { floors: 1, steps: [5, 5], fights: [[1, 2]],         elites: 0,
            groups: ['RRM', 'RRR', 'RRR'], elite: ['ERR'], boss: ['BM'], room: 28, eliteFind: 30,
            chest: { wealth: 30, items: [['good', 1]] } },
  yellow: { floors: 1, steps: [5, 6], fights: [[2, 3]],         elites: 0,
            groups: ['RRR', 'RRRM', 'HRR'], elite: ['ERR'], boss: ['BR'], room: 30, eliteFind: 45,
            chest: { wealth: 60, items: [['rare', 1]] } },
  orange: { floors: 2, steps: [5, 5], fights: [[1, 2], [1, 2]], elites: 1,
            groups: ['RRR', 'RRRM', 'HRR', 'HRRM'], elite: ['ERR'], boss: ['BRM'], room: 32, eliteFind: 60,
            chest: { wealth: 80, items: [['rare', 2]] } },
  red:    { floors: 2, steps: [5, 6], fights: [[2, 3], [1, 2]], elites: 1,
            groups: ['RRR', 'HRR', 'RRRM', 'HRM'], elite: ['ER', 'ERR'], boss: ['BRM'], room: 50, eliteFind: 90,
            chest: { wealth: 180, items: [['epic', 1], ['rare', 1]] } },
  purple: { floors: 2, steps: [5, 6], fights: [[2, 3], [2, 3]], elites: 2,
            groups: ['HRR', 'RRRM', 'HHM', 'HRRM'], elite: ['ER', 'ERM'], boss: ['BRR'], room: 64, eliteFind: 120,
            chest: { wealth: 380, items: [['epic', 2], ['rare', 2]] } },
};
// A floor's fights as a range. A single figure (a test's hand-made floor) means within one of it, and never under two.
const fightRange = f => (Array.isArray(f) ? f : [Math.max(2, f - 1), f + 1]);

const EVENTS_BUILT = false;   // build step 6: until then, an event's place is taken by treasure

// ── Names ───────────────────────────────────────────────────────────────────
const LANDS = ['plains', 'forest', 'hills', 'mountain', 'river', 'marsh', 'ruins'];
const NAMES = {
  plains:   ['The Barrow in the Barley', 'The Sunken Fold', 'Tollkeeper\'s Cellar', 'The Burrow under the Stile', 'Windmill Deeps', 'The Long Warren'],
  forest:   ['The Hollow under the Oak', 'Bramblegate', 'The Root Cellar', 'Mosswell', 'The Den below the Beeches', 'Thornhall'],
  hills:    ['The Stair below the Crag', 'Greystone Burrows', 'The Fold in the Hill', 'Cairnfoot', 'The Old Sett', 'Heatherdelve'],
  mountain: ['The Shaft above the Snowline', 'Eaglecleft', 'The Frozen Stair', 'Scree Halls', 'The High Delving', 'Stormgap'],
  river:    ['The Drowned Mill', 'Weirdeep', 'The Otter\'s Lost Holt', 'Reedgate', 'The Sluice Tunnels', 'Fishbone Grotto'],
  marsh:    ['The Sinking Chapel', 'Mirefast', 'The Reed King\'s Barrow', 'Blackwater Cellars', 'The Peat Halls', 'Toadstone Hollow'],
  ruins:    ['The Broken Keep', 'The Vault under the Tower', 'Crownless Hall', 'The Undercroft', 'The Ash Library', 'The Last Granary'],
};
const INTROS = {
  plains: 'A hole in the open grassland, wider than a fox would dig.', forest: 'Roots, damp earth and something breathing further in.',
  hills: 'A cold draught comes up out of the hillside.', mountain: 'A crack in the rock, with old tool marks round its mouth.',
  river: 'Water runs somewhere below, and not only water.', marsh: 'The ground gives underfoot, and the steps go down into the dark.',
  ruins: 'Fallen stone, and a stair the builders never meant to be found.',
};

// ── Loot by land (DUNGEON_CONTENT.md §8.3) ──────────────────────────────────
// Each grade is a list in order of preference. Some of the plan's items
// (beast horn, dragon tooth, leather armour, the hunter's dagger and cloak,
// dragonscale armour) are in item_seed.js, which nothing loads by itself, so
// a database may not have them: the caller says which items exist (`items`)
// and the first of each list that does is used. The last of every list is
// an item every database has.
const MATERIALS = {
  plains:   { common: ['hide'],          good: ['wool'],                    rare: ['ancient_coin'],      epic: ['dragon_tooth', 'cut_gem'] },
  forest:   { common: ['timber_bundle'], good: ['rare_sap'],                rare: ['ancient_heartwood'], epic: ['ancient_blueprint'] },
  hills:    { common: ['iron_ore'],      good: ['beast_horn', 'iron_ore'],  rare: ['gemstone'],          epic: ['dragon_tooth', 'cut_gem'] },
  mountain: { common: ['iron_ore'],      good: ['beast_horn', 'iron_ore'],  rare: ['gemstone'],          epic: ['dragon_tooth', 'cut_gem'] },
  river:    { common: ['hide'],          good: ['blightbane_herb'],         rare: ['luminous_scale'],    epic: ['dragon_tooth', 'cut_gem'] },
  marsh:    { common: ['hide'],          good: ['blightbane_herb'],         rare: ['luminous_scale'],    epic: ['ancient_blueprint'] },
  ruins:    { common: ['iron_ore'],      good: ['ancient_coin'],            rare: ['ancient_coin'],      epic: ['ancient_blueprint'] },
};
// The piece of gear in the boss chest, by skull: the plan's choices, then one that always exists.
const GEAR = { yellow: ['leather_armour', 'iron_sword'], orange: ['hunters_dagger', 'chainmail'], red: ['hunters_cloak', 'steel_sword'], purple: ['dragonscale_armour', 'steel_sword'] };
// What one of each is worth (item_templates.sell_value), for filling a room to its value.
const WORTH = { hide: 6, wool: 6, timber_bundle: 5, iron_ore: 8, rare_sap: 20, beast_horn: 30, blightbane_herb: 35, ancient_coin: 40, luminous_scale: 40,
  ancient_heartwood: 45, gemstone: 50, ancient_blueprint: 80, cut_gem: 90, dragon_tooth: 100 };
// Items every database has (from the migrations): the fall-backs. Tests check each exists.
const SURE_KEYS = ['hide', 'wool', 'timber_bundle', 'iron_ore', 'rare_sap', 'blightbane_herb', 'ancient_coin', 'luminous_scale', 'ancient_heartwood', 'gemstone',
  'ancient_blueprint', 'cut_gem', 'iron_sword', 'chainmail', 'steel_sword'];
// Every item a generated dungeon might give.
const LOOT_KEYS = [...new Set(Object.values(MATERIALS).flatMap(m => Object.values(m).flat()).concat(Object.values(GEAR).flat()))];
// The first of a preference list that exists (`items`: a Set of item keys, or null for "all do").
const first = (list, items) => list.find(k => !items || items.has(k)) || list[list.length - 1];

// ── Creatures ───────────────────────────────────────────────────────────────
// A creature's rank: its own `rank` when it has one (build step 8), else
// from its health, which sorts today's creatures as the content plan does.
function rankOf(c) {
  if (c.rank) return c.rank;
  const hp = Number(c.max_hp) || 0;
  return hp < 26 ? 'minion' : hp < 55 ? 'regular' : hp < 100 ? 'heavy' : hp < 200 ? 'elite' : 'boss';
}
const RANKS = { M: 'minion', R: 'regular', H: 'heavy', E: 'elite', B: 'boss' };
const NEAREST = { minion: ['minion', 'regular', 'heavy'], regular: ['regular', 'minion', 'heavy'], heavy: ['heavy', 'regular', 'elite', 'minion'],
  elite: ['elite', 'heavy', 'regular', 'minion'], boss: ['boss', 'elite', 'heavy', 'regular', 'minion'] };
// The land's creatures, by rank. A land with none of its own borrows everyone.
function poolFor(creatures, terrain) {
  const fit = (creatures || []).filter(c => c && c.id && (Number(c.max_hp) || 0) >= 10 && !c.archived)
    .map(c => ({ id: c.id, name: c.name || c.id.replace(/_/g, ' '), hp: Number(c.max_hp) || 0, rank: rankOf(c), biomes: Array.isArray(c.biomes) ? c.biomes : null }))
    .sort((a, b) => a.id < b.id ? -1 : 1);
  const local = fit.filter(c => !c.biomes || c.biomes.includes(terrain));
  const use = local.length ? local : fit;
  const by = {};
  for (const c of use) (by[c.rank] = by[c.rank] || []).push(c);
  return { all: use, by, local: local.length > 0 };
}
// Creatures for a group such as 'HRR'. → { enemies, standin }
function groupFor(pool, shape, rnd) {
  const out = [], count = {};
  let standin = false;
  for (const ch of shape) {
    const want = RANKS[ch];
    let list = null, got = null;
    for (const r of NEAREST[want]) { if (pool.by[r] && pool.by[r].length) { list = pool.by[r]; got = r; break; } }
    if (!list) continue;
    let c;
    if (got !== want && (want === 'elite' || want === 'boss' || want === 'heavy')) {
      // No creature of that rank in this land: its strongest stands in.
      c = list.slice().sort((a, b) => b.hp - a.hp || (a.id < b.id ? -1 : 1))[0];
      if (want !== 'heavy') standin = true;
    } else {
      const fresh = list.filter(x => (count[x.id] || 0) < 2);
      c = pick(rnd, fresh.length ? fresh : list);
    }
    count[c.id] = (count[c.id] || 0) + 1;
    out.push(c);
  }
  // An elite or the boss stands at the back, behind its company; a heavy holds the front.
  const led = shape[0] === 'E' || shape[0] === 'B';
  return { enemies: (led ? out.slice(1).concat(out.slice(0, 1)) : out).map(c => c.id), lead: out[0] || null, standin };
}

// ── Layout: rooms per step, and the links between steps ─────────────────────
// Every way of linking a step of `a` rooms to one of `b` rooms (both sorted by
// lane) so that links never cross, every room is linked, and no room links to
// more than two. → a list of link sets, each [[i, j], …].
function linkings(a, b) {
  const out = [];
  const walk = (i, j, links, outDeg) => {
    if (i === a - 1 && j === b - 1) { out.push(links); return; }
    if (i < a - 1 && j < b - 1) walk(i + 1, j + 1, links.concat([[i + 1, j + 1]]), 1);
    if (i < a - 1) walk(i + 1, j, links.concat([[i + 1, j]]), 1);
    if (j < b - 1 && outDeg < 2) walk(i, j + 1, links.concat([[i, j + 1]]), outDeg + 1);
  };
  walk(0, 0, [[0, 0]], 1);
  return out;
}
const LANE_SETS = { 1: [[2]], 2: [[1, 3], [1, 3], [1, 2], [2, 3]], 3: [[1, 2, 3]] };
const ID = 'abcdefghij';
function layoutFloor(rnd, steps, last) {
  const counts = [1];
  for (let s = 2; s < steps; s++) {
    const prev = counts[counts.length - 1];
    const three = prev >= 2 && rnd() < 0.4;          // a single room can lead to two at most
    counts.push(three ? 3 : 2);
  }
  counts.push(1);
  const rows = counts.map((n, i) => pick(rnd, LANE_SETS[n]).map(lane => ({
    id: i === steps - 1 ? (last ? 'boss' : 'land') : `${ID[i]}${lane}`, step: i + 1, lane, type: null, next: [],
  })));
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    for (const [x, y] of pick(rnd, linkings(A.length, B.length))) A[x].next.push(B[y].id);
  }
  return rows;
}

// ── Route rules, beyond dungeon_defs.checkFloor ─────────────────────────────
// Every way through the floor: fights within one of the skull's figure (and
// never fewer than two), one or two rests, and never a third fight in a row
// without a room that is not a fight to take instead. Treasure is never the
// safe road: no two treasure rooms in a row, and two at most on any route.
// An elite is always a choice: whoever can walk into it can walk somewhere
// else. Returns problems.
function checkRoutes(floor, { fights, last = true } = {}) {
  const out = [], rooms = floor.rooms, byId = new Map(rooms.map(r => [r.id, r]));
  const end = rooms.reduce((n, r) => Math.max(n, r.step), 1);
  const isFight = r => DEFS.FIGHTS.includes(r.type);
  const add = p => { if (!out.includes(p)) out.push(p); };
  const [lo, hi] = fightRange(fights);
  const walk = (r, f, rests, run, gold, goldRun) => {
    const fightHere = isFight(r) && r.type !== 'boss';
    const nf = f + (fightHere ? 1 : 0), nr = rests + (r.type === 'rest' ? 1 : 0), nrun = isFight(r) ? run + 1 : 0;
    const ng = gold + (r.type === 'treasure' ? 1 : 0), ngRun = r.type === 'treasure' ? goldRun + 1 : 0;
    if (ngRun >= 2) add(`two treasure rooms in a row (${r.id})`);
    if (nrun >= 3) add(`a route has three fights in a row (${r.id})`);
    if (nrun === 2 && r.step < end && (r.next || []).every(n => isFight(byId.get(n)))) add(`after two fights in a row there is no way round a third (${r.id})`);
    if (r.step === end) {
      if (nf < lo || nf > hi) add(`a route has ${nf} fights (${lo} to ${hi})`);
      if (nr < 1 || nr > 2) add(`a route has ${nr} rests (1 or 2)`);
      if (ng > 2) add(`a route has ${ng} treasure rooms (2 at most)`);
      return;
    }
    for (const n of r.next || []) walk(byId.get(n), nf, nr, nrun, ng, ngRun);
  };
  rooms.filter(r => r.step === 1).forEach(r => walk(r, 0, 0, 0, 0, 0));
  for (const e of rooms.filter(r => r.type === 'elite')) {
    for (const p of rooms.filter(r => (r.next || []).includes(e.id))) {
      if (!(p.next || []).some(n => n !== e.id && byId.get(n).type !== 'elite')) add(`${e.id}: an elite must be a choice, with another way on beside it`);
    }
  }
  return out;
}

// Room types for one laid-out floor: a seeded search, step by step from the
// door. At each step it tries the mixes of fight, rest and treasure for that
// step's rooms in a seeded order, carrying for every room what any route to
// it has met so far (fights, rests, treasure, and the run of fights or of
// treasure it is in), and drops a mix the moment a rule is broken or can no
// longer be met. So it finds a floor that obeys the rules whenever the layout
// has one. → true when it did.
// `elite`: this floor must also have a fight that can become an elite.
function typeFloor(rnd, rows, { fights, last, elite = false }) {
  const end = rows.length, [lo, hi] = fightRange(fights);
  const parents = new Map();
  for (const r of rows.flat()) for (const n of r.next) { if (!parents.has(n)) parents.set(n, []); parents.get(n).push(r); }
  const KINDS = ['fight', 'rest', 'treasure'];
  const mixes = (n, noRest) => {
    const kinds = noRest ? KINDS.filter(k => k !== 'rest') : KINDS;
    let out = [[]];
    for (let i = 0; i < n; i++) out = out.flatMap(m => kinds.map(k => m.concat([k])));
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  };
  // A route's state on leaving a room: [fights, rests, treasure, fight run, treasure run, came from a rest]
  rows[0][0].type = 'fight';
  let budget = 40000;
  const place = (i, states) => {
    if (budget-- <= 0) return false;
    const row = rows[i];
    if (i === end - 1) {
      const room = row[0];
      room.type = last ? 'boss' : 'landing';
      for (const p of parents.get(room.id) || []) for (const st of states.get(p.id)) {
        if (st[0] < lo || st[0] > hi || st[1] < 1) return false;
        if (last && st[3] >= 2) return false;                     // two fights and then the boss
      }
      if (elite && !eliteSpots(rows).length) return false;
      // Somewhere on the floor the ways on must differ in kind.
      return rows.some(r => new Set(r.map(x => x.type)).size > 1);
    }
    const left = end - 2 - i;                                      // steps still to come before the last room
    for (const mix of mixes(row.length, i === 1)) {                // no rest straight after the door's fight
      // A step whose rooms are all rests, or all treasure, is no choice at all
      // (rooms that are all fights still differ in who is in them).
      if (row.length > 1 && mix[0] !== 'fight' && mix.every(t => t === mix[0])) continue;
      const next = new Map();
      let ok = true;
      for (let k = 0; k < row.length && ok; k++) {
        const t = mix[k], seen = new Set(), list = [];
        for (const p of parents.get(row[k].id) || []) for (const st of states.get(p.id)) {
          if (t === 'rest' && st[5]) { ok = false; break; }       // two rests in a row
          const ns = [st[0] + (t === 'fight' ? 1 : 0), st[1] + (t === 'rest' ? 1 : 0), st[2] + (t === 'treasure' ? 1 : 0),
            t === 'fight' ? st[3] + 1 : 0, t === 'treasure' ? st[4] + 1 : 0, t === 'rest' ? 1 : 0];
          if (ns[3] >= 3 || ns[4] >= 2 || ns[0] > hi || ns[1] > 2 || ns[2] > 2) { ok = false; break; }
          if (ns[0] + left < lo || (ns[1] === 0 && left === 0)) { ok = false; break; }   // can no longer be met
          const key = ns.join();
          if (!seen.has(key)) { seen.add(key); list.push(ns); }
        }
        next.set(row[k].id, list);
      }
      if (!ok) continue;
      row.forEach((r, k) => { r.type = mix[k]; });
      if (place(i + 1, next)) return true;
    }
    return false;
  };
  if (!place(1, new Map([[rows[0][0].id, [[1, 0, 0, 1, 0, 0]]]]))) return false;
  // The whole floor against the written rules, as a guard on the search above.
  const floor = { rooms: rows.flat().map(r => DEFS.FIGHTS.includes(r.type) ? { ...r, enemies: ['x'] } : { ...r }) };
  return !DEFS.checkFloor(floor, { last }).length && !checkRoutes(floor, { fights, last }).length;
}
// The safe floor, should every seeded try run out: the same kind of room in
// every lane of a step (treasure, fight, rest, …). It obeys every rule but
// offers no choice of kind, so it is the last resort; `notes.safe_layout`
// says when it was used (the tests count how often: not once in 35,000).
function safeFloor(rows, last) {
  const end = rows.length, cycle = ['treasure', 'fight', 'rest', 'treasure', 'fight'];
  for (const r of rows.flat()) r.type = r.step === 1 ? 'fight' : r.step === end ? (last ? 'boss' : 'landing') : cycle[(r.step - 2) % cycle.length];
}

// Which fight rooms could become an elite: from step 3 on, not the last
// room, and every room leading to it has another way on.
function eliteSpots(rows) {
  const flat = rows.flat(), end = rows.length;
  return flat.filter(r => r.type === 'fight' && r.step >= 3 && r.step < end
    && flat.filter(p => p.next.includes(r.id)).every(p => p.next.length > 1));
}

// ── Loot ────────────────────────────────────────────────────────────────────
// One treasure room: about half its value in the land's material (the best
// grade the skull allows that one room can afford), the rest in wealth.
function treasure(rnd, terrain, tier, value, items) {
  const m = MATERIALS[terrain] || MATERIALS.plains;
  const grades = tier === 'green' ? ['common'] : tier === 'yellow' ? ['good', 'common'] : ['rare', 'good', 'common'];
  const grade = grades.find(g => (WORTH[first(m[g], items)] || 10) <= value) || 'common';
  const item = first(m[grade], items), worth = WORTH[item] || 10;
  const qty = Math.max(1, Math.min(4, Math.round(value / 2 / worth)));
  return { wealth: Math.max(5, Math.round((value - qty * worth) * (0.85 + rnd() * 0.3))), items: [{ item, qty }] };
}
function chest(terrain, tier, shape, items) {
  const m = MATERIALS[terrain] || MATERIALS.plains, out = [];
  for (const [grade, qty] of shape.chest.items) {
    const item = first(m[grade], items), have = out.find(i => i.item === item);
    if (have) have.qty += qty; else out.push({ item, qty });
  }
  if (GEAR[tier]) out.push({ item: first(GEAR[tier], items), qty: 1 });
  return { wealth: shape.chest.wealth, items: out };
}

// ── The generator ───────────────────────────────────────────────────────────
//   items: the item keys that exist (a Set or a list), for choosing loot; leave out for "all of them".
function generate({ seed, tier = 'green', terrain = 'forest', creatures = [], items = null } = {}) {
  const known = items ? new Set(items) : null;
  const key = DEFS.TIERS[tier] ? tier : 'green';
  const land = LANDS.includes(terrain) ? terrain : 'forest';
  const shape = SHAPES[key];
  const s = Number(seed) || 1;
  const pool = poolFor(creatures, land);
  if (!pool.all.length) throw Object.assign(new Error('There are no creatures to put in a dungeon.'), { status: 500 });

  // Which floors hold an elite: one to a floor, on the floors the seed picks.
  const eliteFloors = Array.from({ length: shape.floors }, (_, i) => i)
    .sort((a, b) => hash(`${s}|elite-floor|${a}`) - hash(`${s}|elite-floor|${b}`)).slice(0, shape.elites);

  // Layout and room types, floor by floor.
  const floorRows = [];
  let safe = false;
  for (let f = 0; f < shape.floors; f++) {
    const last = f === shape.floors - 1;
    const lay = stream(s, `layout:${f}`), typ = stream(s, `types:${f}`);
    const steps = between(lay, shape.steps[0], shape.steps[1]);
    // A layout whose rooms cannot be given types that obey the rules is drawn again.
    let rows = null, ok = false;
    for (let tries = 0; tries < 20 && !ok; tries++) {
      rows = layoutFloor(lay, steps, last);
      ok = typeFloor(typ, rows, { fights: shape.fights[f], last, elite: eliteFloors.includes(f) });
    }
    if (!ok) { safeFloor(rows, last); safe = true; }
    floorRows.push(rows);
  }
  // On each of those floors, one fight that has another way on beside it becomes the elite.
  const er = stream(s, 'elites');
  let elitesLeft = shape.elites;
  for (const f of eliteFloors) {
    const spots = eliteSpots(floorRows[f]);
    if (!spots.length) continue;              // only on the last-resort layout
    pick(er, spots).type = 'elite';
    elitesLeft--;
  }

  // What is in each room.
  const totalSteps = floorRows.reduce((n, rows) => n + rows.length, 0);
  let before = 0, bossLead = null, standins = 0;
  const floors = floorRows.map((rows, f) => {
    const out = rows.flat().map(r => {
      const room = { id: r.id, step: r.step, lane: r.lane, type: r.type, next: r.next.slice() };
      const rnd = stream(s, `room:${f}:${r.id}`);
      if (r.type === 'fight') {
        // Harder groups the deeper the room, with a little play either way.
        const depth = (before + r.step - 1) / Math.max(1, totalSteps - 1);
        const i = Math.max(0, Math.min(shape.groups.length - 1, Math.floor(depth * shape.groups.length + (rnd() - 0.5))));
        room.enemies = groupFor(pool, shape.groups[i], rnd).enemies;
      } else if (r.type === 'elite') {
        const g = groupFor(pool, pick(rnd, shape.elite), rnd);
        room.enemies = g.enemies;
        room.loot = { wealth: Math.round(shape.eliteFind * 0.4), items: [{ item: first((MATERIALS[land] || MATERIALS.plains).rare, known), qty: 1 }] };
        if (g.standin) { room.boost = { hp: 0.5 }; room.standin = true; standins++; }
      } else if (r.type === 'boss') {
        const g = groupFor(pool, pick(rnd, shape.boss), rnd);
        room.enemies = g.enemies;
        bossLead = g.lead;
        if (g.standin) { room.boost = { hp: 1.0 }; room.standin = true; standins++; }
      } else if (r.type === 'treasure') {
        room.loot = treasure(rnd, land, key, shape.room, known);
      }
      return room;
    });
    before += rows.length;
    return { rooms: out };
  });

  const t = DEFS.TIERS[key];
  return {
    name: pick(stream(s, 'name'), NAMES[land]),
    tier: key, terrain: land, generated: true, seed: s, combat: 'board',
    intro: INTROS[land],
    boss: bossLead ? `${/^[aeiou]/i.test(bossLead.name) ? 'an' : 'a'} ${bossLead.name} grown great and old` : 'something old',
    floors,
    clear: chest(land, key, shape, known),
    notes: { standins, safe_layout: safe, elites: shape.elites - elitesLeft, events: EVENTS_BUILT },
  };
}

// Everything the rules ask of a generated dungeon, in one place (tests, and
// a guard before a dungeon is stored). Returns problems.
function check(story) {
  const out = DEFS.checkStory(story);
  const shape = SHAPES[story.tier];
  if (!shape) return out.concat(['unknown skull']);
  if (story.floors.length !== shape.floors) out.push(`${story.floors.length} floors (${shape.floors})`);
  story.floors.forEach((f, i) => {
    const last = i === story.floors.length - 1;
    const steps = f.rooms.reduce((n, r) => Math.max(n, r.step), 0);
    if (steps < shape.steps[0] || steps > shape.steps[1]) out.push(`floor ${i + 1}: ${steps} steps (${shape.steps[0]} to ${shape.steps[1]})`);
    checkRoutes(f, { fights: shape.fights[i], last }).forEach(p => out.push(`floor ${i + 1}: ${p}`));
    if (f.rooms.filter(r => r.type === 'elite').length > 1) out.push(`floor ${i + 1}: more than one elite`);
    for (const r of f.rooms) if (r.type === 'treasure' && !(r.loot && (r.loot.wealth > 0 || (r.loot.items || []).length))) out.push(`floor ${i + 1}: ${r.id} is an empty treasure room`);
  });
  if (story.floors.flatMap(f => f.rooms).filter(r => r.type === 'elite').length > shape.elites) out.push('too many elites');
  return out;
}

module.exports = { generate, check, checkRoutes, linkings, poolFor, rankOf, SHAPES, fightRange, LANDS, NAMES, MATERIALS, GEAR, WORTH, LOOT_KEYS, SURE_KEYS, EVENTS_BUILT, _layoutFloor: layoutFloor, _stream: stream };
