// ══════════════════════════════════════════════════════════════════════════
//  dungeons_test — a party's run through a dungeon (lib/dungeons.js,
//  lib/dungeon_defs.js, lib/dungeon_gen.js, routes/dungeons.js;
//  docs/DUNGEONS.md §10). Every fight is a battle on the board
//  (docs/TACTICS.md); the fight itself is scripts/dungeon_board_test.js and
//  scripts/tactics_test.js. The card battles left the dungeons on 2026-11-23
//  and their checks (the door draft, decks, honing) went with them.
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/dungeons_test.js
//  Part 1 needs nothing. Part 2 needs the database and the running server.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, detail) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg + (detail ? ' — ' + detail : '')); }
}

function part1() {
  const DEFS = require('../lib/dungeon_defs');
  const D = require('../lib/dungeons');
  console.log('Rules');
  for (const [k, s] of Object.entries(DEFS.STORIES)) check(DEFS.checkStory(s).length === 0, `${k} obeys the path rules`);
  const base = () => JSON.parse(JSON.stringify(DEFS.STORIES.test_green.floors[0]));
  const bad = (edit, re, msg) => { const f = base(); edit(f.rooms); check(DEFS.checkFloor(f).some(p => re.test(p)), msg); };
  bad(r => { r.find(x => x.id === 'a').type = 'rest'; }, /first room is always a fight/, 'a floor that opens on a rest is refused');
  bad(r => { r.find(x => x.id === 'c2').next = ['d1']; }, /two rests in a row/, 'two rests in a row are refused');
  bad(r => { r.find(x => x.id === 'b2').type = 'elite'; }, /never comes before step 3/, 'an elite before step 3 is refused');
  bad(r => { r.find(x => x.id === 'd1').type = 'treasure'; delete r.find(x => x.id === 'd1').enemies; }, /a route has no rest/, 'a route with no rest on it is refused');
  bad(r => { r.find(x => x.id === 'boss').type = 'fight'; }, /must end in a boss/, 'the deepest floor must end in the boss');
  bad(r => { r.find(x => x.id === 'c1').next = ['boss']; }, /not in the next step/, 'a link that skips a step is refused');
  bad(r => { r.find(x => x.id === 'b1').next = []; }, /links to 0 rooms/, 'a room that leads nowhere is refused');
  bad(r => { r.find(x => x.id === 'a').next = ['b2']; }, /b1: no route leads here/, 'a room no route reaches is refused');
  check(DEFS.checkFloor(base(), { last: false }).some(p => /must end in a landing/.test(p)), 'a floor that is not the deepest must end in a landing');
  bad(r => { r.find(x => x.id === 'c2').type = 'event'; }, /not built yet/, 'event rooms are not accepted yet');

  const t = DEFS.TIERS;
  check(DEFS.TIER_ORDER.join() === 'green,yellow,orange,red,purple', 'five skulls, green to purple');
  check(!('hp' in t.green) && !('deck' in t.green) && t.green.wealth === 0.2 && t.purple.wealth === 0.4 && DEFS.tier('pink').key === 'green' && DEFS.tier('red').name === 'Deadly',
    'a skull is its name, its share of a fight\'s wealth and the party it expects; how tough its foes are is the board\'s business (scripts/tactics_test.js)');
  check(DEFS.battleSeed(7, 3, 0, 'a') === DEFS.battleSeed(7, 3, 0, 'a') && DEFS.battleSeed(7, 3, 0, 'a') !== DEFS.battleSeed(7, 4, 0, 'a')
    && DEFS.battleSeed(7, 3, 0, 'a') !== DEFS.battleSeed(7, 3, 0, 'b'), 'a battle seed is fixed for a town and room, and differs between towns and rooms');

  const sum = D._addLoot({ wealth: 10, items: [{ item: 'hide', qty: 2 }] }, { wealth: 5, items: [{ item: 'hide', qty: 1 }, { item: 'gemstone', qty: 1 }] });
  check(sum.wealth === 15 && sum.items.find(i => i.item === 'hide').qty === 3 && sum.items.length === 2, 'loot adds up by kind');
  const [kept, lost] = D._splitLoot({ wealth: 31, items: [{ item: 'hide', qty: 3 }, { item: 'gemstone', qty: 1 }] }, 0.5);
  check(kept.wealth === 15 && lost.wealth === 16 && kept.items.length === 1 && kept.items[0].qty === 1 && lost.items.find(i => i.item === 'gemstone').qty === 1,
    'fleeing keeps half of the wealth and of each kind of item, rounded down');
  const rested = D._rest({ party_ids: [1, 2, 3], party_state: { 1: { hp: 10, max: 60 }, 2: { hp: 0, max: 60, down: true, was_down: true }, 3: { hp: 55, max: 60 } } });
  check(rested[1].hp === 40 && rested[2].hp === 30 && rested[2].down === false && rested[2].was_down === true && rested[3].hp === 60,
    'a rest gives back half of full health, stands the downed up with it, and never goes over full');

  // ── The generator (lib/dungeon_gen.js) ──────────────────────────────────
  console.log('The generator');
  const GEN = require('../lib/dungeon_gen');
  const CREATURES = [
    ['marsh_rat', 22, ['marsh', 'river', 'plains']], ['river_pike', 28, ['river', 'marsh']], ['wild_fox', 30, ['forest', 'plains', 'hills']],
    ['rot_shaman', 30, ['ruins']], ['mountain_harpy', 32, ['mountain', 'hills']], ['night_wolf', 34, ['forest', 'plains', 'hills']],
    ['bog_lurker', 34, ['marsh', 'river']], ['withered_husk', 38, ['ruins', 'marsh']], ['fungal_toad', 42, ['marsh', 'forest']],
    ['thornback_boar', 44, ['forest', 'plains']], ['hill_ogre', 60, ['hills']], ['r4_dummy', 1, ['ruins']],
  ].map(([id, max_hp, biomes]) => ({ id, name: id.replace(/_/g, ' '), max_hp, biomes }));
  const gen = (seed, tier, terrain, creatures = CREATURES) => GEN.generate({ seed, tier, terrain, creatures });
  let made = 0, broken = 0, safeLayouts = 0, shortElites = 0, firstBroken = '';
  const SEEDS = 500;
  for (const tier of DEFS.TIER_ORDER) for (let seed = 1; seed <= SEEDS; seed++) {
    const d = gen(seed, tier, GEN.LANDS[seed % GEN.LANDS.length]);
    const p = GEN.check(d);
    made++; if (p.length) { broken++; firstBroken = firstBroken || `${tier} seed ${seed}: ${p[0]}`; }
    if (d.notes.safe_layout) safeLayouts++;
    if (d.notes.elites !== GEN.SHAPES[tier].elites) shortElites++;
  }
  check(made === SEEDS * 5 && broken === 0, `${made} generated dungeons, every one obeys the path and route rules`, firstBroken);
  check(safeLayouts === 0, 'none of them needed the last-resort layout');
  check(shortElites === 0, 'and every one has its elites: none at green and yellow, one at orange and red, two at purple (on different floors)');
  check(JSON.stringify(gen(41, 'orange', 'hills')) === JSON.stringify(gen(41, 'orange', 'hills')), 'the same seed, skull and land always give the same dungeon');
  check(JSON.stringify(gen(41, 'orange', 'hills').floors) !== JSON.stringify(gen(42, 'orange', 'hills').floors), 'another seed gives another dungeon');
  const shapeOf = (tier) => { const out = { floors: new Set(), steps: new Set(), elites: new Set() }; for (let s = 1; s <= 120; s++) { const d = gen(s, tier, 'forest'); out.floors.add(d.floors.length); d.floors.forEach(f => out.steps.add(Math.max(...f.rooms.map(r => r.step)))); out.elites.add(d.floors.flatMap(f => f.rooms).filter(r => r.type === 'elite').length); } return { floors: [...out.floors].sort().join(), steps: [...out.steps].sort().join(), elites: Math.max(...out.elites) }; };
  const sg = shapeOf('green'), sy = shapeOf('yellow'), so = shapeOf('orange'), sr = shapeOf('red'), sp = shapeOf('purple');
  check(sg.floors === '1' && sg.steps === '5' && sy.floors === '1' && sy.steps === '5,6', 'green: one floor of 5 steps; yellow: one floor of 5 or 6');
  check(so.floors === '2' && so.steps === '5' && sr.floors === '2' && sr.steps === '5,6' && sp.floors === '2' && sp.steps === '5,6', 'orange: two floors of 5 steps; red and purple: two of 5 or 6 (a battle on the board is long, so a dungeon is short)');
  // Fights on every way through a whole dungeon, the boss and any elite included.
  const routeFights = (d) => { let lo = 0, hi = 0; for (const f of d.floors) { const by = new Map(f.rooms.map(r => [r.id, r])); let a = 99, b = 0; const walk = (r, n) => { n += DEFS.FIGHTS.includes(r.type) ? 1 : 0; if (!r.next.length) { a = Math.min(a, n); b = Math.max(b, n); return; } r.next.forEach(x => walk(by.get(x), n)); }; f.rooms.filter(r => r.step === 1).forEach(r => walk(r, 0)); lo += a; hi += b; } return [lo, hi]; };
  const span = (tier) => { let lo = 99, hi = 0; for (let s = 1; s <= 200; s++) { const [a, b] = routeFights(gen(s, tier, 'marsh')); lo = Math.min(lo, a); hi = Math.max(hi, b); } return lo + '-' + hi; };
  check(span('green') === '2-3' && span('yellow') === '3-4', 'fights on a way through, boss included: 2 or 3 at green, 3 or 4 at yellow', span('green') + ' ' + span('yellow'));
  check(span('orange') === '3-5' && span('red') === '4-6' && span('purple') === '5-7', '3 to 5 at orange, 4 to 6 at red, 5 to 7 at purple: the careful road at the low end', [span('orange'), span('red'), span('purple')].join(' '));
  const forest = gen(9, 'yellow', 'forest'), keys = forest.floors.flatMap(f => f.rooms).flatMap(r => r.enemies || []);
  check(keys.length > 0 && keys.every(k => ['wild_fox', 'night_wolf', 'fungal_toad', 'thornback_boar'].includes(k)), 'a forest dungeon holds forest creatures only');
  check(!JSON.stringify(gen(3, 'green', 'ruins')).includes('r4_dummy'), 'a creature with next to no health is never used');
  const every = (fn) => { for (const tier of DEFS.TIER_ORDER) for (let s = 1; s <= 60; s++) { const d = gen(s, tier, GEN.LANDS[s % 7]); for (const f of d.floors) if (!fn(f, d)) return false; } return true; };
  check(every(f => f.rooms.filter(r => r.step === 1).length === 1 && f.rooms.filter(r => r.step === 1)[0].type === 'fight'), 'every floor opens on one fight at the door');
  check(every(f => { const end = Math.max(...f.rooms.map(r => r.step)); return f.rooms.filter(r => r.step > 1 && r.step < end).every(r => true) && [...new Set(f.rooms.map(r => r.step))].filter(s => s > 1 && s < end).every(s => { const n = f.rooms.filter(r => r.step === s).length; return n === 2 || n === 3; }); }), 'every step between the door and the last room offers two or three rooms');
  check(every(f => f.rooms.filter(r => r.type === 'elite').every(e => e.step >= 3 && f.rooms.filter(p => p.next.includes(e.id)).every(p => p.next.length === 2))), 'an elite is never before step 3 and always has another way on beside it');
  check(every(f => f.rooms.filter(r => r.type === 'elite').every(e => e.loot && e.loot.items.length === 1 && e.loot.wealth > 0)), 'an elite always has its better find');
  check(every(f => f.rooms.filter(r => r.type === 'treasure').every(t => t.loot.wealth >= 5 && t.loot.items.length === 1 && t.loot.items[0].qty >= 1)), 'every treasure room holds wealth and a material of the land');
  check(every(f => f.rooms.filter(r => DEFS.FIGHTS.includes(r.type)).every(r => r.enemies.length >= 2 && r.enemies.length <= 4)), 'every fight has two to four creatures');
  check(every((f, d) => f.rooms.filter(r => r.type === 'boss').every(r => r.enemies.length === (['green', 'yellow'].includes(d.tier) ? 2 : 3) && r.standin === true && r.boost.hp === 1) && !!d.clear.wealth), 'the boss has one companion at green and yellow and two from orange up; with no boss in the list a boosted stand-in, and a chest behind it');
  check(gen(5, 'green', 'forest').clear.items[0].item === 'rare_sap' && gen(5, 'purple', 'ruins').clear.items.some(i => i.item === 'ancient_blueprint' && i.qty === 2) && gen(5, 'orange', 'hills').clear.items.some(i => i.item === 'hunters_dagger')
    && gen(5, 'purple', 'hills').clear.items.some(i => i.item === 'dragon_tooth') && gen(5, 'purple', 'hills').clear.items.some(i => i.item === 'dragonscale_armour'),
    "the boss chest by skull and land, as the content plan has it: sap in a green forest, blueprints in purple ruins, a hunter's dagger at orange, dragon teeth and dragonscale in purple hills");
  const few = GEN.generate({ seed: 5, tier: 'purple', terrain: 'hills', creatures: CREATURES, items: GEN.SURE_KEYS });
  check(few.clear.items.some(i => i.item === 'cut_gem') && few.clear.items.some(i => i.item === 'steel_sword') && !JSON.stringify(few).includes('dragon') && !JSON.stringify(few).includes('beast_horn'),
    'where a database lacks one of those items, the next on the list is given instead: nothing promised is missing');
  check(GEN.LOOT_KEYS.every(k => GEN.WORTH[k] != null || Object.values(GEN.GEAR).flat().includes(k)) && Object.values(GEN.MATERIALS).every(m => Object.values(m).every(l => GEN.SURE_KEYS.includes(l[l.length - 1]))) && Object.values(GEN.GEAR).every(l => GEN.SURE_KEYS.includes(l[l.length - 1])),
    'every preference list ends in an item every database has');
  // With real elites and bosses in the creature list, no stand-ins and no boost.
  const real = CREATURES.concat([{ id: 'stoat_captain', name: 'Stoat Captain', max_hp: 110, biomes: ['forest'], rank: 'elite' }, { id: 'old_greyfeather', name: 'Old Greyfeather', max_hp: 240, biomes: ['forest'], rank: 'boss' }]);
  const withReal = gen(77, 'orange', 'forest', real), rr = withReal.floors.flatMap(f => f.rooms);
  check(rr.find(r => r.type === 'boss').enemies[2] === 'old_greyfeather' && !rr.find(r => r.type === 'boss').boost && withReal.boss === 'Old Greyfeather' && rr.filter(r => r.type === 'elite').every(r => r.enemies.includes('stoat_captain') && !r.boost) && withReal.notes.standins === 0,
    'once a land has a real elite and boss, they are used as they are');
  check(!rr.filter(r => r.type === 'fight').some(r => r.enemies.includes('old_greyfeather') || r.enemies.includes('stoat_captain')), 'and never turn up in an ordinary fight');
  check(GEN.linkings(1, 2).length === 1 && GEN.linkings(1, 3).length === 0 && GEN.linkings(3, 1).length === 1 && GEN.linkings(2, 3).length > 0
    && [GEN.linkings(2, 3), GEN.linkings(3, 3), GEN.linkings(3, 2), GEN.linkings(2, 2)].every(sets => sets.every(l => l.every(([i, j], n) => n === 0 || (i >= l[n - 1][0] && j >= l[n - 1][1])) && [0, 1, 2].every(i => l.filter(x => x[0] === i).length <= 2))),
    'links between steps never cross, reach every room, and no room leads to more than two');
  const row = (id, step, lane, type, next) => ({ id, step, lane, type, next, enemies: ['x'] });
  const three = { rooms: [row('a', 1, 2, 'fight', ['b']), row('b', 2, 2, 'fight', ['c1', 'c2']), row('c1', 3, 1, 'fight', ['d']), row('c2', 3, 3, 'rest', ['d']), row('d', 4, 2, 'rest', ['boss']), row('boss', 5, 2, 'boss', [])] };
  check(GEN.checkRoutes(three, { fights: 2 }).some(p => /three fights in a row/.test(p)), 'three fights in a row on a route are refused');
  const forced = { rooms: [row('a', 1, 2, 'fight', ['b']), row('b', 2, 2, 'fight', ['c']), row('c', 3, 2, 'fight', ['boss']), row('boss', 4, 2, 'boss', [])] };
  check(GEN.checkRoutes(forced, { fights: 2 }).some(p => /no way round a third/.test(p)), 'two fights with nothing but a third ahead are refused');
  const lone = { rooms: [row('a', 1, 2, 'fight', ['b']), row('b', 2, 2, 'rest', ['c']), row('c', 3, 2, 'elite', ['boss']), row('boss', 4, 2, 'boss', [])] };
  check(GEN.checkRoutes(lone, { fights: 2 }).some(p => /an elite must be a choice/.test(p)), 'an elite with no other way on beside it is refused');
  const rich = { rooms: [row('a', 1, 2, 'fight', ['b']), row('b', 2, 2, 'treasure', ['c']), row('c', 3, 2, 'treasure', ['d']), row('d', 4, 2, 'rest', ['e']), row('e', 5, 2, 'fight', ['f']), row('f', 6, 2, 'treasure', ['boss']), row('boss', 7, 2, 'boss', [])] };
  check(GEN.checkRoutes(rich, { fights: 2 }).some(p => /two treasure rooms in a row/.test(p)) && GEN.checkRoutes(rich, { fights: 2 }).some(p => /3 treasure rooms/.test(p)), 'treasure is never the safe road: two in a row, or three on one route, are refused');
  check(GEN.rankOf({ max_hp: 22 }) === 'minion' && GEN.rankOf({ max_hp: 44 }) === 'regular' && GEN.rankOf({ max_hp: 60 }) === 'heavy' && GEN.rankOf({ max_hp: 22, rank: 'boss' }) === 'boss', "a creature's rank is its own when it has one, else read from its health");

  // ── The catalogue of abilities (lib/class_abilities.js): the board reads an ability's numbers from its formula ────
  console.log('The abilities');
  const CA = require('../lib/class_abilities'), TS = require('../lib/tactics_setup');
  const stats = { strength: 10, agility: 10, endurance: 10, intelligence: 10, charisma: 10, combatSkill: 3 };
  const reads = k => { const n = TS.read(CA.ability(k).formula, stats); return !!(n.dmg || n.block || n.heal || Object.keys(n.fx).length); };
  check(Object.keys(CA.ABILITIES).length === 59 && Object.keys(CA.ABILITIES).every(reads), 'every ability in the catalogue has a formula the board can read into something it does', Object.keys(CA.ABILITIES).filter(k => !reads(k)).join());
  const cf = role => CA.classFor({ role });
  check(cf('soldier').cls === 'guard' && cf('archer').cls === 'archer' && cf('wizard').cls === 'wizard' && cf('hearthkeeper').cls === 'hearthkeeper' && cf('soldier').trade === null, 'a Guard, Archer, Wizard or Hearthkeeper fights as their class');
  check(cf('farmer').cls === 'villager' && cf('farmer').trade === 't_tool' && cf('scout').trade === 't_spot' && cf('blacksmith').trade === 't_shore' && cf('porter').trade === 't_ration' && cf('tavernkeep').trade === 't_drink' && cf('scholar').trade === 't_signs',
    'anyone else fights as a villager, with the one ability their kind of job gives them');
  check(cf('idle').cls === 'villager' && cf('idle').trade === null && cf(undefined).cls === 'villager', 'a citizen with no job is a villager with no trade ability');
  check(CA.CLASS_ORDER.join() === 'guard,archer,wizard,hearthkeeper,villager' && CA.CLASS_ORDER.every(k => CA.CLASSES[k].label && CA.CLASSES[k].icon) && CA.CLASSES.guard.career === 'soldier' && CA.CLASSES.villager.career === null
    && Object.values(TS.KITS).every(kit => kit.abilities.every(a => CA.ability(a.key))) && Object.values(TS.TRADE_KIT).every(a => CA.ability(a.key)),
    'five ways to fight, each with its job, and every ability in a kit is in the catalogue');
  check(!CA.PACKS && !CA.honed && !CA.poolFor && !CA.seed, 'packs, honing, pools and the card table went with the cards');
  const CR = require('../lib/combat_resolver');
  let fatal = 0, fatalSafe = 0;
  for (let i = 0; i < 4000; i++) { if (CR.rollInjuryFor({}).severity === 'fatal') fatal++; if (CR.rollInjuryFor({ no_fatal: true }).severity === 'fatal') fatalSafe++; }
  check(fatal > 0 && fatalSafe === 0, 'the roll for a citizen who was stood back up has no fatal result');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const D = require('../lib/dungeons');
  const DEFS = require('../lib/dungeon_defs');
  const E = require('../lib/tactics_engine');
  const F = require('../lib/tactics_foes');
  const T = require('../lib/tactics_setup');
  const TU = require('../lib/tuning');
  let seq = 0;
  const X = -70000 - Math.floor(Math.random() * 5000) * 20;
  // A town with six adults: a Guard, an Archer and four with no job. Strong ones win their fights; weak ones lose them.
  async function player(name, { strong = true } = {}) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [u.id, username, X + seq * 40])).rows[0];
    const stats = strong ? { strength: 40, agility: 14, endurance: 20, intelligence: 12, charisma: 10 } : { strength: 1, agility: 1, endurance: 1, intelligence: 1, charisma: 1 };
    const roles = ['soldier', 'archer', 'idle', 'idle', 'idle', 'idle'], cits = [];
    for (let i = 0; i < 6; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female',$3,$4,$5,'adult') RETURNING id`,
      [s.id, `${name}${i}${RUN}`, roles[i], JSON.stringify(stats), JSON.stringify({ combat: strong ? 8 : 1 })])).rows[0].id);
    return { id: u.id, sid: s.id, cits, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const runRow = async (p) => (await q('SELECT * FROM dungeon_runs WHERE settlement_id=$1 ORDER BY id DESC LIMIT 1', [p.sid])).rows[0];
  const wealth = async (p) => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  const have = async (p, item) => Number((await q('SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [p.sid, item])).rows[0].n);
  const battleOf = async (p, id) => (await api(p, 'GET', '/api/tactics/battles/' + id)).body.battle;
  // Fight a battle on the board through the routes, the engine's mind choosing for the party
  // (scripts/dungeon_board_test.js looks at the fight itself; here it is a way to the run's rules).
  // → the last answer, which carries `dungeon` once the battle has ended, and the state played to.
  async function fight(p, battleId) {
    const bt = await battleOf(p, battleId);
    const st = E.replay(bt.setup, bt.actions).state;
    let n = bt.count, last = null;
    for (let g = 0; g < 500 && st.status === 'active'; g++) {
      const u = E.current(st), keep = st.r, plan = E.plan(st); st.r = keep;
      const acts = [];
      if (plan && plan.to && (plan.to.x !== u.x || plan.to.y !== u.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
      if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
      acts.push({ t: 'end' });
      for (const a of acts) {
        if (st.status !== 'active' || !E.apply(st, a)) continue;
        last = await api(p, 'POST', `/api/tactics/battles/${battleId}/act`, { n: n++, action: a });
        if (last.status !== 200) return { last, st, bt };
      }
    }
    return { last, st, bt };
  }
  // A foe's health at a skull, as the board works it out (lib/tactics_setup.js foeUnit).
  const foeHp = (key, tier, boost = 0, by = T.TIERS[tier].hp) => Math.max(1, Math.round(F.foe(key).hp * (1 + by + boost)));

  await TU.setSwitch('dungeons.on', true);
  try {
    // ── Setting out ──────────────────────────────────────────────────────
    console.log('Setting out');
    const a = await player('Delve');
    let e = await D.startTest(a.id, 'test_green', a.cits.slice(0, 5)).catch(x => x);
    check(e.status === 400 && /one to 4/.test(e.message), 'five citizens are refused: a party is one to four', e.message);
    {
      // A smaller party may go; the dungeon is the same one.
      const few = await player('Few');
      const two = await D.startTest(few.id, 'test_green', few.cits.slice(0, 2));
      check(two.run.status === 'active' && two.run.party.length === 2 && two.run.rooms.length > 0, 'two citizens may go in by themselves');
      await D.leave(few.id);
      const one = await D.startTest(few.id, 'test_green', few.cits.slice(2, 3));
      check(one.run.status === 'active' && one.run.party.length === 1, 'and so may one');
      await D.leave(few.id);
    }
    await q("UPDATE citizens SET life_stage='child', born_at = NOW() WHERE id=$1", [a.cits[5]]);
    e = await D.startTest(a.id, 'test_green', [a.cits[0], a.cits[1], a.cits[2], a.cits[5]]).catch(x => x);
    check(e.status === 400 && /too young/.test(e.message), 'a child is refused');
    await q("UPDATE citizens SET life_stage='adult', born_at = NULL WHERE id=$1", [a.cits[5]]);
    const other = await player('Other');
    e = await D.startTest(a.id, 'test_green', [a.cits[0], a.cits[1], a.cits[2], other.cits[0]]).catch(x => x);
    check(e.status === 400, "another town's citizen is refused");
    check((await q("SELECT COUNT(*)::int AS n FROM dungeons d WHERE d.source='test' AND NOT EXISTS (SELECT 1 FROM dungeon_runs r WHERE r.dungeon_id = d.id) AND d.created_at > NOW() - interval '1 minute'")).rows[0].n === 0,
      'a refused start leaves no dungeon behind');

    const party = a.cits.slice(0, 4);
    let v = (await D.startTest(a.id, 'test_green', party)).run;
    check(v.status === 'active' && v.floor === 0 && v.room === null && v.moves.join() === 'a' && v.pending === null, 'the party stands at the door: nothing to choose, and the only way on is the first room');
    check(v.party.length === 4 && v.party.every(m => m.hp === m.max && m.max > 20 && !m.down && !('deck' in m)), 'all four start at full health, and carry no deck');
    check(v.dungeon.tier === 'green' && v.dungeon.floors === 1 && v.rooms.length === 8 && v.rooms.find(r => r.id === 'a').enemies.map(x => x.name).join() === 'Wolf Raider,Boar Bruiser,Wolf Raider' && v.dungeon.suggested_party === 'villagers',
      'the dungeon card: skull, floors, who it expects, and the whole floor with who waits in each fight');
    check(!JSON.stringify(v.rooms).includes('timber_bundle') && v.rooms.every(r => !('loot' in r)), 'what a treasure room holds is not sent ahead');
    check(v.can_leave === true && v.can_flee === false, 'between rooms the party may turn back, and there is nothing to flee');
    e = await D.startTest(a.id, 'test_green', a.cits.slice(2, 6)).catch(x => x);
    check(e.status === 400 && /already has a party/.test(e.message), 'a second run while one is unfinished is refused');

    const OS = require('../lib/outpost_state');
    const c0 = (await q('SELECT id, name, settlement_id, life_stage FROM citizens WHERE id=$1', [party[0]])).rows[0];
    check(/is in a dungeon/.test(await OS.busyReason(c0, a.sid)), 'a citizen in a dungeon is busy, between rooms too');
    check((await D.busyCitizenIds(a.cits)).sort().join() === party.slice().sort().join(), 'exactly the four in the party are busy');
    check((await require('../lib/careers').awayMap(null, a.sid)).get(party[1]) === 'dungeon', 'they show as away in a dungeon');
    let r = await api(a, 'GET', '/api/dungeons/run');
    check(r.status === 200 && r.body.on === true && r.body.run && r.body.run.id === v.id, 'GET /run gives the unfinished run (for resuming)');

    // ── The first fight, played through the battle routes ───────────────
    console.log('A fight, and wounds that carry');
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'boss' });
    check(r.status === 400 && /not connected/.test(r.body.error), 'a room that is not connected is refused');
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const b1 = r.body.board_battle_id;
    check(r.status === 200 && b1 > 0 && r.body.run.pending.kind === 'battle' && r.body.run.pending.battle_id === b1 && r.body.run.can_leave === false && r.body.run.can_flee === true,
      'entering a fight room opens a battle on the board; now the party can only win, lose or flee');
    let bt = await battleOf(a, b1);
    const dseed = (await q('SELECT seed FROM dungeons WHERE id=$1', [(await runRow(a)).dungeon_id])).rows[0].seed;
    check(bt.source === 'dungeon' && bt.dungeon_run_id === v.id && bt.status === 'active' && bt.setup.dungeon.room === 'a' && Number((await runRow(a)).board_battle_id) === b1,
      'the battle is a kept battle that names its run and its room, and the run names it');
    check(Number(bt.seed) === DEFS.battleSeed(dseed, a.sid, 0, 'a'), 'its seed comes from the dungeon, the town and the room');
    const wolf = bt.setup.enemies.find(x => x.key === 'wolf_raider');
    check(wolf.maxHp === foeHp('wolf_raider', 'green') && wolf.maxHp > F.foe('wolf_raider').hp && bt.setup.enemies.every(x => x.maxHp === foeHp(x.key, 'green')),
      `the skull's numbers are in the battle: a Wolf Raider has ${wolf.maxHp} health in a green dungeon (${F.foe('wolf_raider').hp} on its sheet)`);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    check(r.status === 400 && /Finish the fight/.test(r.body.error), 'no walking on while the fight is open');
    r = await api(a, 'POST', '/api/dungeons/run/leave');
    check(r.status === 400, 'no turning back in the middle of a fight');
    const w0 = await wealth(a);
    const f1 = await fight(a, b1), d1 = f1.last.body.dungeon;
    check(f1.st.status === 'victory' && f1.last.body.battle.status === 'victory', 'the party wins the fight', `${f1.st.round} rounds`);
    v = d1 && d1.run;
    check(v && v.status === 'active' && v.room === 'a' && !v.room_open && v.pending === null && v.moves.join() === 'b1,b2', 'after the win the party is back on the path, with two ways on and nothing to choose first');
    const left = E.resultOf(f1.st).party;
    check(v.party.every(m => { const u = left.find(x => x.citizen_id === m.id); return u && m.down === u.down && m.hp === Math.max(u.down ? 0 : 1, u.hp); }), "each citizen's health on the path is their health at the end of the fight");
    check(v.loot.wealth > 0 && d1.found.wealth === v.loot.wealth && d1.ended === false && (await wealth(a)) === w0, 'the wealth found is held by the run, not paid yet; the answer says what this fight gave', `+${d1.found.wealth}`);
    bt = await battleOf(a, b1);
    check(bt.status === 'victory' && bt.result && (await runRow(a)).board_battle_id === null && (await q("SELECT COUNT(*)::int AS n FROM settlement_quests WHERE settlement_id=$1 AND quest_id='dungeon_room'", [a.sid])).rows[0].n === 0,
      'the battle is closed and the run no longer names it; no card battle and no quest row was made for the room');
    check((await q("SELECT COUNT(*)::int AS n FROM citizen_events WHERE settlement_id=$1 AND event_type='injury'", [a.sid])).rows[0].n === 0, 'no injury is rolled after a room');
    r = await api(a, 'POST', `/api/tactics/battles/${b1}/act`, { n: bt.count, action: { t: 'end' } });
    check(r.status !== 200 && (await runRow(a)).loot.wealth === v.loot.wealth, 'a battle that is over takes no more turns, and gives nothing more');
    const again = E.replay(bt.setup, bt.actions).state, again2 = E.replay(bt.setup, bt.actions).state;
    check(again.status === 'victory' && E.checksum(again) === E.checksum(again2) && JSON.stringify(E.resultOf(again).party) === JSON.stringify(left),
      'the stored battle replays to exactly the same result');

    // ── The next fight starts from those wounds ─────────────────────────
    const st = (await runRow(a)).party_state;
    for (const id of party) st[id] = { ...st[id], hp: Math.max(1, st[id].hp || 0), down: false, was_down: false };     // whatever the first fight did, start this part clean
    st[party[0]] = { ...st[party[0]], hp: 7 };
    st[party[1]] = { ...st[party[1]], hp: 0, down: true, was_down: true };
    await q('UPDATE dungeon_runs SET party_state=$2 WHERE id=$1', [v.id, JSON.stringify(st)]);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'b2' });
    bt = await battleOf(a, r.body.board_battle_id);
    const u0 = bt.setup.party.find(u => u.citizen_id === party[0]), u1 = bt.setup.party.find(u => u.citizen_id === party[1]), u2 = bt.setup.party.find(u => u.citizen_id === party[2]);
    check(u0.hp === 7 && u0.maxHp > 7 && (u2.hp == null ? u2.maxHp : u2.hp) === st[party[2]].hp, 'a wounded citizen walks into the next fight with the health they had');
    const begun = E.replay(bt.setup, []).state, body = begun.units.find(u => u.citizen_id === party[1]);
    check(u1.down === true && body.down && body.hp === 0 && !begun.order.includes(body.id) && begun.status === 'active', 'a downed citizen is brought along, lying at 0 health, and takes no turn; the fight goes on with the three who are standing');
    const won = await D.adminWin(a.id);
    v = won.run;
    check(v.party.find(m => m.id === party[1]).down && v.party.find(m => m.id === party[1]).was_down && v.party.find(m => m.id === party[0]).hp === 7, 'after the fight she is still down; nothing heals between rooms by itself');

    // ── Rest, treasure, boss ────────────────────────────────────────────
    console.log('Rest, treasure and the boss');
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    check(r.status === 400, 'nothing to decide outside a rest room');
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'c2' });
    check(r.status === 200 && r.body.run.pending.kind === 'rest' && r.body.run.pending.options.map(o => o.key).join() === 'rest' && r.body.run.moves.length === 0 && /gets back 50% of their full health/.test(r.body.run.pending.options[0].text),
      'a rest room asks before the party walks on: a rest, and nothing else');
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'deeper' });
    check(r.status === 400, 'an answer that is not offered is refused');
    check((await api(a, 'POST', '/api/dungeons/run/choose', { option: 'hone', citizen_id: party[0], card: 'g_strike' })).status === 400, 'honing a card went with the cards');
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    v = r.body.run;
    const m0 = v.party.find(m => m.id === party[0]), m1 = v.party.find(m => m.id === party[1]);
    check(D.CONFIG.BOARD_REST === 0.5 && m0.hp === Math.min(m0.max, 7 + Math.round(m0.max * 0.5)) && m1.down === false && m1.hp === Math.round(m1.max * 0.5) && m1.was_down === true, 'resting gives back half and stands the downed citizen up with it');
    check(v.moves.join() === 'd2' && !v.room_open, 'then the way on is open');
    const lootBefore = v.loot.wealth, qtyOf = (run, k) => (run.loot.items.find(i => i.item === k) || { qty: 0 }).qty;
    const timberHeld = qtyOf(v, 'timber_bundle');   // a foe may have dropped some already
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'd2' });
    v = r.body.run;
    check(r.body.found.wealth === 15 && r.body.found.items[0].item_key === 'timber_bundle' && v.loot.wealth === lootBefore + 15 && qtyOf(v, 'timber_bundle') === timberHeld + 2 && !v.room_open,
      'a treasure room adds its find to the run loot, with no fight');
    const sap0 = await have(a, 'rare_sap'), timber0 = await have(a, 'timber_bundle'), w1 = await wealth(a);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'boss' });
    bt = await battleOf(a, r.body.board_battle_id);
    const ogre = bt.setup.enemies.find(x => x.key === 'hill_ogre');
    check(r.body.run.pending.room === 'boss' && bt.setup.fight === 'boss' && ogre.maxHp === foeHp('hill_ogre', 'green', 1), "the last room is the boss, and the room's own boost is added to the skull's", `the ogre has ${ogre.maxHp}`);
    const cleared = await D.adminWin(a.id);
    v = cleared.run;
    check(cleared.ended && v.status === 'cleared' && v.result.ending === 'cleared', 'beating the boss clears the dungeon');
    check(cleared.found.wealth >= 30 && cleared.found.items.some(i => i.item_key === 'rare_sap'), 'the boss chest: the clear reward on top of the fight');
    check((await wealth(a)) === w1 + v.result.kept.wealth && v.result.kept.wealth === v.loot.wealth && v.result.kept.wealth > lootBefore + 15 + 30 - 1, 'all the held wealth is paid when the run ends');
    check((await have(a, 'rare_sap')) === sap0 + qtyOf(v, 'rare_sap') && qtyOf(v, 'rare_sap') >= 1 && (await have(a, 'timber_bundle')) === timber0 + qtyOf(v, 'timber_bundle'), 'and the items go into the stores');
    check(v.result.rolled.length === 1 && v.result.rolled[0].id === party[1] && v.result.rolled[0].no_fatal === true, 'only the citizen who went down rolls for injury, and stood back up she rolls without the fatal result');
    check(v.result.injuries.every(i => i.citizen_id === party[1] && i.severity !== 'fatal'), 'no injury for anyone else, and none fatal');
    check((await q("SELECT COUNT(*)::int AS n FROM chronicle WHERE settlement_id=$1 AND kind='quest' AND text LIKE '%cleared it%' AND citizen_ids @> $2::jsonb", [a.sid, JSON.stringify([party[0]])])).rows[0].n === 1, 'the clear is in the chronicle for the party');
    check((await q("SELECT COUNT(*)::int AS n FROM settlement_events WHERE settlement_id=$1 AND type='dungeon'", [a.sid])).rows[0].n === 1, 'and in the town news');
    check((await OS.busyReason(c0, a.sid)) === null && (await D.busyCitizenIds(party)).length === 0, 'the party is free again');
    r = await api(a, 'GET', '/api/dungeons/run');
    check(r.body.run === null && r.body.last && r.body.last.status === 'cleared', 'GET /run then gives the finished run to read');
    e = await D.start(a.id, (await runRow(a)).dungeon_id, party).catch(x => x);
    check(e.status === 400 && /already been/.test(e.message), 'a town gets one attempt at a dungeon');
    for (const p of ['move', 'choose', 'leave', 'flee']) { r = await api(a, 'POST', '/api/dungeons/run/' + p, { room: 'a', option: 'rest' }); if (r.status !== 404) { check(false, `${p} on a finished run should be 404, got ${r.status}`); } }
    check(true, 'a finished run takes no more moves');

    // ── Turning back ────────────────────────────────────────────────────
    console.log('Turning back');
    const t = await player('Turn');
    await D.startTest(t.id, 'test_green', t.cits.slice(0, 4));
    await api(t, 'POST', '/api/dungeons/run/move', { room: 'a' });
    await D.adminWin(t.id);
    r = await api(t, 'POST', '/api/dungeons/run/flee');
    check(r.status === 400 && /not in a fight/.test(r.body.error), 'between rooms there is nothing to flee');
    await api(t, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    const tw = await wealth(t), held = (await runRow(t)).loot, hadT = {};
    for (const i of held.items) hadT[i.item] = await have(t, i.item);
    r = await api(t, 'POST', '/api/dungeons/run/leave');
    v = r.body.run;
    let allHome = held.items.length > 0;
    for (const i of held.items) if ((await have(t, i.item)) !== hadT[i.item] + i.qty) allHome = false;
    check(r.status === 200 && v.status === 'left' && v.result.kept.wealth === held.wealth && held.wealth > 0 && (await wealth(t)) === tw + held.wealth && allHome, 'turning back keeps everything found so far', held.items.map(i => `${i.qty} ${i.item}`).join(', '));
    check(v.result.rolled.length === 0 && v.result.injuries.length === 0, 'nobody went down, so nobody rolls');
    check((await q("SELECT COUNT(*)::int AS n FROM chronicle WHERE settlement_id=$1 AND kind='quest'", [t.sid])).rows[0].n === 0, 'turning back is not a chronicle entry');

    // ── Fleeing ─────────────────────────────────────────────────────────
    console.log('Fleeing a fight');
    const f = await player('Flee');
    const fp = f.cits.slice(0, 4);
    await D.startTest(f.id, 'test_green', fp);
    await api(f, 'POST', '/api/dungeons/run/move', { room: 'a' });
    await D.adminWin(f.id);
    await api(f, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    await q(`UPDATE dungeon_runs SET loot = '{"wealth": 41, "items": [{"item": "hide", "qty": 3}]}' WHERE settlement_id=$1 AND status='active'`, [f.sid]);
    const fs = (await runRow(f)).party_state;
    fs[fp[2]] = { ...fs[fp[2]], was_down: true };          // went down earlier and was stood back up
    await q(`UPDATE dungeon_runs SET party_state=$2 WHERE settlement_id=$1 AND status='active'`, [f.sid, JSON.stringify(fs)]);
    r = await api(f, 'POST', '/api/dungeons/run/move', { room: 'c1' });
    const b3 = r.body.board_battle_id;
    const fw = await wealth(f), fh = await have(f, 'hide');
    r = await api(f, 'POST', '/api/dungeons/run/flee');
    v = r.body.run;
    check(r.status === 200 && v.status === 'fled' && v.result.half === true, 'fleeing a fight ends the run');
    check(v.result.kept.wealth === 20 && v.result.lost.wealth === 21 && (await wealth(f)) === fw + 20 && (await have(f, 'hide')) === fh + 1 && v.result.lost.items.find(i => i.item_key === 'hide').qty === 2,
      'half the wealth and half of each kind of item is kept (rounded down); the rest is dropped');
    check(v.result.rolled.length === 1 && v.result.rolled[0].id === fp[2] && v.result.rolled[0].no_fatal === true, 'only those who went down roll');
    check((await battleOf(f, b3)).status === 'left' && (await D.busyCitizenIds(fp)).length === 0, 'the fight is closed and the party is home');
    // Walking out of the battle from the battle screen does the same.
    const f2 = await player('Forfeit');
    await D.startTest(f2.id, 'test_green', f2.cits.slice(0, 4));
    r = await api(f2, 'POST', '/api/dungeons/run/move', { room: 'a' });
    r = await api(f2, 'POST', `/api/tactics/battles/${r.body.board_battle_id}/leave`);
    check(r.status === 200 && r.body.dungeon.run.status === 'fled', "leaving a dungeon's battle from the battle screen is fleeing");

    // ── Defeat ──────────────────────────────────────────────────────────
    console.log('Defeat');
    const l = await player('Lost', { strong: false });
    const lp = l.cits.slice(0, 4);
    await D.startTest(l.id, 'test_orange', lp);
    await q(`UPDATE dungeon_runs SET loot = '{"wealth": 50, "items": [{"item": "hide", "qty": 4}]}' WHERE settlement_id=$1 AND status='active'`, [l.sid]);
    r = await api(l, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const lw = await wealth(l), lh = await have(l, 'hide');
    const lostFight = await fight(l, r.body.board_battle_id);
    check(lostFight.st.status === 'defeat' && lostFight.last.body.battle.status === 'defeat', 'four weak villagers lose a fight in an orange dungeon');
    v = lostFight.last.body.dungeon.run;
    check(v.status === 'defeat' && lostFight.last.body.dungeon.ended === true && !lostFight.last.body.rewards, 'a lost battle ends the run in defeat, and teaches nothing');
    check(v.result.kept.wealth === 0 && v.result.kept.items.length === 0 && v.result.lost.wealth === 50 && (await wealth(l)) === lw && (await have(l, 'hide')) === lh, 'all the loot from the run is lost');
    check(v.result.rolled.length === 4 && v.result.rolled.every(x => x.no_fatal === false) && lp.every(id => v.result.rolled.some(x => x.id === id)) && (lostFight.last.body.rolls || []).length === 4, 'every citizen in the party rolls on the full injury table');
    check((await q("SELECT COUNT(*)::int AS n FROM chronicle WHERE settlement_id=$1 AND kind='quest' AND text LIKE '%driven out%'", [l.sid])).rows[0].n === 1, 'the defeat is in the chronicle');
    check((await D.busyCitizenIds(lp)).length === 0, 'the party is home');

    // ── Left alone ──────────────────────────────────────────────────────
    console.log('Left alone');
    const i1 = await player('Idle');
    await D.startTest(i1.id, 'test_green', i1.cits.slice(0, 4));
    await api(i1, 'POST', '/api/dungeons/run/move', { room: 'a' });
    await D.adminWin(i1.id);
    await api(i1, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    const iw = await wealth(i1), iheld = (await runRow(i1)).loot.wealth;
    await q(`UPDATE dungeon_runs SET last_action_at = NOW() - interval '23 hours' WHERE settlement_id=$1 AND status='active'`, [i1.sid]);
    await D.sweep();
    check((await runRow(i1)).status === 'active', 'a run 23 hours idle is still waiting');
    await q(`UPDATE dungeon_runs SET last_action_at = NOW() - interval '25 hours' WHERE settlement_id=$1 AND status='active'`, [i1.sid]);
    await D.sweep();
    let row = await runRow(i1);
    check(row.status === 'timed_out' && row.result.half === false && row.result.kept.wealth === iheld && (await wealth(i1)) === iw + iheld, 'after 24 idle hours between rooms it ends as turned back: everything kept');
    const i2 = await player('IdleFight');
    await D.startTest(i2.id, 'test_green', i2.cits.slice(0, 4));
    await q(`UPDATE dungeon_runs SET loot = '{"wealth": 40, "items": []}' WHERE settlement_id=$1 AND status='active'`, [i2.sid]);
    r = await api(i2, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const b5 = r.body.board_battle_id;
    const stale = () => q(`UPDATE dungeon_runs SET last_action_at = NOW() - interval '25 hours' WHERE settlement_id=$1 AND status='active'`, [i2.sid]);
    const fresh = async () => new Date((await runRow(i2)).last_action_at) > new Date(Date.now() - 60000);
    await stale();
    await battleOf(i2, b5);
    check(await fresh(), 'opening the fight again counts as an action: the run is not idle');
    await stale();
    r = await api(i2, 'POST', `/api/tactics/battles/${b5}/act`, { n: 0, action: { t: 'end' } });
    check(r.status === 200 && await fresh(), 'and so does every turn taken in it');
    await stale();
    const i2w = await wealth(i2);
    await D.sweep();
    row = await runRow(i2);
    check(row.status === 'timed_out' && row.result.half === true && row.result.kept.wealth === 20 && (await wealth(i2)) === i2w + 20, 'idle in the middle of a fight costs what fleeing costs: half the loot, never a defeat');
    check((await battleOf(i2, b5)).status === 'left' && row.board_battle_id === null, 'and the open battle is closed');

    // ── Two floors and a landing ────────────────────────────────────────
    console.log('Two floors');
    const o = await player('Deep');
    v = (await D.startTest(o.id, 'test_orange', o.cits.slice(0, 4))).run;
    check(v.dungeon.tier === 'orange' && v.dungeon.floors === 2, 'an orange dungeon with two floors');
    r = await api(o, 'POST', '/api/dungeons/run/move', { room: 'a' });
    bt = await battleOf(o, r.body.board_battle_id);
    check(bt.setup.tier === 'orange' && bt.setup.enemies.every(x => x.maxHp === foeHp(x.key, 'orange')) && foeHp('wolf_raider', 'orange') > foeHp('wolf_raider', 'green'), 'orange foes are tougher than green ones: the same Wolf Raider, more health',
      `${foeHp('wolf_raider', 'green')} → ${foeHp('wolf_raider', 'orange')}`);
    await D.adminWin(o.id);
    await api(o, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    r = await api(o, 'POST', '/api/dungeons/run/move', { room: 'c1' });
    bt = await battleOf(o, r.body.board_battle_id);
    check(r.body.run.pending.room === 'elite' && bt.setup.fight === 'elite' && bt.setup.enemies.every(x => x.maxHp === foeHp(x.key, 'orange', 0.5)), "an elite room's own boost is added to the skull's");
    const before = (await runRow(o)).loot;
    const eliteWin = await D.adminWin(o.id);
    check(eliteWin.found.items.some(i => i.item_key === 'gemstone') && eliteWin.found.wealth >= 30 && eliteWin.run.loot.wealth >= before.wealth + 30, 'an elite always gives its better find');
    await api(o, 'POST', '/api/dungeons/run/move', { room: 'd1' });
    await api(o, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    r = await api(o, 'POST', '/api/dungeons/run/move', { room: 'land' });
    v = r.body.run;
    check(v.pending.kind === 'landing' && v.pending.options.map(x => x.key).join() === 'rest,deeper' && v.can_leave === true && v.moves.length === 0, 'the landing: rest, go deeper, or turn back');
    r = await api(o, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    check(r.status === 200 && r.body.run.pending.kind === 'landing' && r.body.run.pending.options.map(x => x.key).join() === 'deeper', 'the party can rest once at a landing');
    r = await api(o, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    check(r.status === 400, 'a second rest there is refused');
    r = await api(o, 'POST', '/api/dungeons/run/choose', { option: 'deeper' });
    v = r.body.run;
    check(r.status === 200 && v.floor === 1 && v.room === null && v.moves.join() === 'e' && v.rooms.some(x => x.id === 'boss') && !v.rooms.some(x => x.id === 'land'), 'going deeper puts the party at the door of the second floor');
    check(v.loot.wealth === eliteWin.run.loot.wealth, 'the loot comes down with them');
    r = await api(o, 'POST', '/api/dungeons/run/leave');
    check(r.body.run.status === 'left', 'and they can still turn back from there');

    // ── Generated dungeons ──────────────────────────────────────────────
    console.log('Generated dungeons');
    const GEN = require('../lib/dungeon_gen');
    const haveItems = (await q('SELECT item_key FROM item_templates WHERE item_key = ANY($1::text[])', [GEN.LOOT_KEYS])).rows.map(x => x.item_key);
    check(GEN.SURE_KEYS.every(k => haveItems.includes(k)), 'the fall-back items every generated dungeon can rely on exist', GEN.SURE_KEYS.filter(k => !haveItems.includes(k)).join());
    const worth = (await q('SELECT item_key, sell_value FROM item_templates WHERE item_key = ANY($1::text[])', [Object.keys(GEN.WORTH)])).rows;
    check(worth.length >= GEN.SURE_KEYS.length - 3 && worth.every(x => Number(x.sell_value) === GEN.WORTH[x.item_key]), "and the generator's idea of what each is worth matches its sale value");
    for (const [tier, land] of [['purple', 'hills'], ['orange', 'mountain'], ['yellow', 'plains']]) {
      const row = await D.createGenerated({ tier, terrain: land, seed: 31, source: 'test' });
      const keys = [...new Set(row.layout.floors.flatMap(f => f.rooms).flatMap(r => (r.loot && r.loot.items) || []).concat(row.layout.clear.items).map(i => i.item))];
      const found = (await q('SELECT item_key FROM item_templates WHERE item_key = ANY($1::text[])', [keys])).rows.length;
      if (found !== keys.length) check(false, `a stored ${tier} ${land} dungeon names an item this database lacks`, keys.join());
      const foes = row.layout.floors.flatMap(f => f.rooms).flatMap(r => r.enemies || []);
      if (!foes.length || !foes.every(k => F.FOES[k]) || row.layout.combat !== 'board' || GEN.check(row.layout).length) check(false, `a stored ${tier} ${land} dungeon is not a sound dungeon of the board's foes`, [...new Set(foes)].join());
      await q('DELETE FROM dungeons WHERE id=$1', [row.id]);
    }
    check(true, "a dungeon as stored only ever names items this database has, and only the board's own foes");
    e = await D.createGenerated({ tier: 'pink', terrain: 'forest' }).catch(x => x);
    check(e.status === 400, 'an unknown skull is refused');
    e = await D.createGenerated({ tier: 'green', terrain: 'moon' }).catch(x => x);
    check(e.status === 400, 'an unknown land is refused');
    // Walk a run to its end: win every fight outright, rest where offered, go deeper at a landing, take the first way on.
    async function walk(p) {
      let view = (await api(p, 'GET', '/api/dungeons/run')).body.run, rooms = 0;
      for (let guard = 0; view && view.status === 'active' && guard < 80; guard++) {
        if (view.pending && view.pending.kind === 'battle') view = (await D.adminWin(p.id)).run;
        else if (view.pending) view = (await api(p, 'POST', '/api/dungeons/run/choose', { option: view.pending.options.some(o => o.key === 'rest') ? 'rest' : 'deeper' })).body.run;
        else { view = (await api(p, 'POST', '/api/dungeons/run/move', { room: view.moves[0] })).body.run; rooms++; }
      }
      return { view, rooms };
    }
    for (const [tier, land] of [['green', 'forest'], ['yellow', 'marsh'], ['orange', 'hills'], ['red', 'ruins'], ['purple', 'river']]) {
      const gp = await player('Gen' + tier);
      v = (await D.startGenerated(gp.id, { tier, terrain: land, seed: 1234 }, gp.cits.slice(0, 4))).run;
      const made = GEN.generate({ seed: 1234, tier, terrain: land, creatures: F.castFor(land, 1234).creatures });
      const sameRooms = JSON.stringify(v.rooms.map(x => [x.id, x.type, x.next, x.enemies.map(en => en.key)])) === JSON.stringify(made.floors[0].rooms.map(x => [x.id, x.type, x.next, x.enemies || []]));
      const gw = await wealth(gp);
      const done = await walk(gp);
      const steps = made.floors.reduce((n, f) => n + Math.max(...f.rooms.map(x => x.step)), 0);
      check(v.dungeon.generated && v.dungeon.tier === tier && v.dungeon.name === made.name && v.dungeon.seed === 1234 && sameRooms && done.view.status === 'cleared' && done.rooms === steps
        && done.view.result.kept.wealth >= made.clear.wealth && (await wealth(gp)) === gw + done.view.result.kept.wealth,
        `a generated ${tier} ${land} dungeon (${made.name}, ${made.floors.length} floor${made.floors.length === 1 ? '' : 's'}) plays from the door to the boss chest`, `${done.view.status}, ${done.rooms} of ${steps} rooms`);
    }
    // One dungeon, two towns: the same rooms, different rolls.
    const shared = await D.createGenerated({ tier: 'green', terrain: 'forest', seed: 99, source: 'test' });
    const t1 = await player('Twin'), t2 = await player('Twin');
    const v1 = (await D.start(t1.id, shared.id, t1.cits.slice(0, 4))).run, v2 = (await D.start(t2.id, shared.id, t2.cits.slice(0, 4))).run;
    check(JSON.stringify(v1.rooms) === JSON.stringify(v2.rooms) && v1.dungeon.name === v2.dungeon.name, 'two towns in the same dungeon see the same rooms');
    const tb1 = await battleOf(t1, (await api(t1, 'POST', '/api/dungeons/run/move', { room: v1.moves[0] })).body.board_battle_id);
    const tb2 = await battleOf(t2, (await api(t2, 'POST', '/api/dungeons/run/move', { room: v2.moves[0] })).body.board_battle_id);
    check(tb1.setup.enemies.map(x => x.key).join() === tb2.setup.enemies.map(x => x.key).join() && String(tb1.seed) !== String(tb2.seed), 'and meet the same foes there, each with their own rolls');
    await api(t1, 'POST', '/api/dungeons/run/flee'); await api(t2, 'POST', '/api/dungeons/run/flee');

    // ── Wizards and Hearthkeepers ───────────────────────────────────────
    console.log('Wizards and Hearthkeepers');
    const BLD = require('../buildings').BUILDINGS, CL = require('../lib/careers/classes');
    const { build } = require('./_build');
    check(BLD.hearth_shrine.minTier === 'village' && BLD.wizard_tower.minTier === 'town' && BLD.hearth_shrine.maxLevel === 3 && BLD.wizard_tower.maxLevel === 3
      && BLD.hearth_shrine.citizenSlots(2) === 2 && BLD.wizard_tower.citizenSlots(3) === 3, 'the Hearth Shrine from Village tier and the Wizard\'s Tower from Town tier: three levels, one seat a level');
    check(CL.ASSIGNABLE.includes('wizard') && CL.ASSIGNABLE.includes('hearthkeeper') && CL.CLASSES.wizard.kind === 'combat' && CL.CLASSES.hearthkeeper.kind === 'combat'
      && CL.CLASSES.wizard.needs.join() === 'wizard_tower' && CL.CLASSES.hearthkeeper.needs.join() === 'hearth_shrine' && CL.CLASSES.wizard.primary === 'intelligence' && CL.CLASSES.hearthkeeper.secondary === 'charisma',
      'Wizard and Hearthkeeper are fighting careers that need their building');
    check(CL.CLASSES.wizard.tree.length === 11 && CL.CLASSES.hearthkeeper.tree.length === 11 && CL.CLASSES.wizard.tree.filter(x => x.capstone).length === 1
      && [...CL.CLASSES.wizard.tree, ...CL.CLASSES.hearthkeeper.tree].every(x => x.id.startsWith('wizard.') || x.id.startsWith('hearthkeeper.')), 'each has a skill tree of its own, with a capstone');
    const wz = await player('Tower');   // a Village
    const [wizId, hkId, thirdId, fourthId] = wz.cits;
    const role = (cid, r2) => api(wz, 'PATCH', `/api/citizens/${cid}/role`, { role: r2 });
    r = await role(wizId, 'wizard');
    check(r.status === 400, 'no Wizards without a tower', r.body.error);
    r = await build((m, pth, body) => api(wz, m, pth, body), wz.sid, 'wizard_tower');
    check(r.status !== 200, "a Village cannot build the Wizard's Tower", JSON.stringify(r.body).slice(0, 120));
    r = await build((m, pth, body) => api(wz, m, pth, body), wz.sid, 'hearth_shrine');
    check(r.status === 200, 'a Village can build the Hearth Shrine', JSON.stringify(r.body).slice(0, 120));
    r = await role(hkId, 'hearthkeeper');
    check(r.status === 200 && (await q('SELECT role FROM citizens WHERE id=$1', [hkId])).rows[0].role === 'hearthkeeper', 'and then a citizen can become a Hearthkeeper');
    await q("UPDATE settlements SET tier='town' WHERE id=$1", [wz.sid]);
    r = await build((m, pth, body) => api(wz, m, pth, body), wz.sid, 'wizard_tower');
    check(r.status === 200, "a Town can build the Wizard's Tower", JSON.stringify(r.body).slice(0, 120));
    r = await role(wizId, 'wizard');
    check(r.status === 200 && (await q('SELECT role FROM citizens WHERE id=$1', [wizId])).rows[0].role === 'wizard', 'and then a citizen can become a Wizard');
    await D.startTest(wz.id, 'test_green', [wizId, hkId, thirdId, fourthId]);
    r = await api(wz, 'POST', '/api/dungeons/run/move', { room: 'a' });
    bt = await battleOf(wz, r.body.board_battle_id);
    const wU = bt.setup.party.find(u => u.citizen_id === wizId), hU = bt.setup.party.find(u => u.citizen_id === hkId);
    check(wU.cls === 'wizard' && wU.abilities.length >= 2 && wU.abilities.filter(x => x.school !== 'basics').every(x => x.key.startsWith('w_') && x.school === 'wild') && wU.abilities[0].key === 'v_swing' && wU.abilities.some(x => x.kind === 'attack' && x.max > 1), 'in a dungeon the Wizard fights as a Wizard: the plain blow everyone has, and spells of their own, cast from a distance', wU.abilities.map(x => x.name).join(', '));
    check(hU.cls === 'hearthkeeper' && hU.abilities.filter(x => x.school !== 'basics').every(x => x.key.startsWith('h_') && x.school === 'hearth') && hU.abilities.some(x => x.kind === 'heal'), 'and the Hearthkeeper as a Hearthkeeper, with a heal', hU.abilities.map(x => x.name).join(', '));
    await api(wz, 'POST', '/api/dungeons/run/flee');

    // ── The switch ──────────────────────────────────────────────────────
    console.log('The switch');
    const g = await player('Gate');
    await D.startTest(g.id, 'test_green', g.cits.slice(0, 4));
    await TU.setSwitch('dungeons.on', false);
    r = await api(g, 'POST', '/api/dungeons/run/move', { room: 'a' });
    check(r.status === 403, 'with the switch off, a player cannot play a run');
    r = await api(g, 'GET', '/api/dungeons/run');
    check(r.status === 200 && r.body.on === false && r.body.run === null, 'and is told dungeons are not open');
    for (const p of [['GET', '/api/dungeons/admin/status'], ['POST', '/api/dungeons/admin/test'], ['POST', '/api/dungeons/admin/generate'], ['POST', '/api/dungeons/admin/switch'], ['POST', '/api/dungeons/admin/sweep'], ['POST', '/api/dungeons/admin/heal'], ['POST', '/api/dungeons/admin/win']]) {
      r = await api(g, p[0], p[1], p[0] === 'POST' ? {} : undefined);
      if (r.status !== 403) check(false, `${p[1]} should be admins only, got ${r.status}`);
    }
    check(true, 'the Dev Tools routes are for admins only');
    for (const p of [['POST', '/api/dungeons/run/pick'], ['GET', '/api/dungeons/cards'], ['POST', '/api/dungeons/cards/prepare']]) {
      r = await api(g, p[0], p[1], p[0] === 'POST' ? {} : undefined);
      if (r.status !== 404) check(false, `${p[1]} went with the cards and should be 404, got ${r.status}`);
    }
    check(true, 'the routes for drafting and preparing cards are gone');
    await TU.setSwitch('dungeons.on', true);
    await api(g, 'POST', '/api/dungeons/run/leave');
    const nums = (await TU.lifeAll()).filter(n => n.group === 'Dungeons');
    check(nums.length === 14 && nums.some(n => n.key === 'DUNGEON_WALK_SECS') && nums.filter(n => /^DUNGEON_FOE_(HP|POW)_/.test(n.key)).length === 10 && !nums.some(n => /^DUNGEON_(HP|STR)_|^DUNGEON_REST$/.test(n.key)),
      "thirteen dungeon numbers are tunable from Dev Tools: each skull's foe health and power, the rest, the flight and the idle hours");
    await TU.setLife('DUNGEON_FOE_HP_GREEN', 0.8);
    const g2 = await player('Tuned');
    await D.startTest(g2.id, 'test_green', g2.cits.slice(0, 4));
    r = await api(g2, 'POST', '/api/dungeons/run/move', { room: 'a' });
    bt = await battleOf(g2, r.body.board_battle_id);
    check(bt.setup.enemies.every(x => x.maxHp === foeHp(x.key, 'green', 0, 0.8)) && foeHp('wolf_raider', 'green', 0, 0.8) > foeHp('wolf_raider', 'green'), "changing a skull's number in Dev Tools changes the next fight",
      `a Wolf Raider: ${foeHp('wolf_raider', 'green')} → ${bt.setup.enemies.find(x => x.key === 'wolf_raider').maxHp}`);
    await TU.resetLife('DUNGEON_FOE_HP_GREEN');
    await api(g2, 'POST', '/api/dungeons/run/flee');
  } finally {
    await q("DELETE FROM life_tuning WHERE key = 'dungeons.on' OR key LIKE 'DUNGEON_%'").catch(() => {});
    await pool.end();
  }
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) await part2();
  else console.log('(no DATABASE_URL: skipped the database part)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
