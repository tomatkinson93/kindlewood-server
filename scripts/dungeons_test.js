// ══════════════════════════════════════════════════════════════════════════
//  dungeons_test — a party's run through a dungeon (lib/dungeons.js,
//  lib/dungeon_defs.js, routes/dungeons.js; docs/DUNGEONS.md §10).
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
  check(t.green.hp === 0.5 && t.green.str === 0.4 && t.purple.hp === 2 && t.purple.str === 1.5, 'creature health and strength: +50%/+40% at green, +200%/+150% at purple');
  check(t.green.deck === 12 && t.orange.deck === 14 && t.purple.deck === 16, 'deck sizes 12, 14, 16');
  check(DEFS.battleSeed(7, 3, 0, 'a') === DEFS.battleSeed(7, 3, 0, 'a') && DEFS.battleSeed(7, 3, 0, 'a') !== DEFS.battleSeed(7, 4, 0, 'a')
    && DEFS.battleSeed(7, 3, 0, 'a') !== DEFS.battleSeed(7, 3, 0, 'b'), 'a battle seed is fixed for a town and room, and differs between towns and rooms');

  const sum = D._addLoot({ wealth: 10, items: [{ item: 'hide', qty: 2 }] }, { wealth: 5, items: [{ item: 'hide', qty: 1 }, { item: 'gemstone', qty: 1 }] });
  check(sum.wealth === 15 && sum.items.find(i => i.item === 'hide').qty === 3 && sum.items.length === 2, 'loot adds up by kind');
  const [kept, lost] = D._splitLoot({ wealth: 31, items: [{ item: 'hide', qty: 3 }, { item: 'gemstone', qty: 1 }] }, 0.5);
  check(kept.wealth === 15 && lost.wealth === 16 && kept.items.length === 1 && kept.items[0].qty === 1 && lost.items.find(i => i.item === 'gemstone').qty === 1,
    'fleeing keeps half of the wealth and of each kind of item, rounded down');
  const rested = D._rest({ party_ids: [1, 2, 3], party_state: { 1: { hp: 10, max: 60 }, 2: { hp: 0, max: 60, down: true, was_down: true }, 3: { hp: 55, max: 60 } } });
  check(rested[1].hp === 28 && rested[2].hp === 18 && rested[2].down === false && rested[2].was_down === true && rested[3].hp === 60,
    'a rest gives back 30% of full health, stands the downed up with it, and never goes over full');

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
  check(sg.floors === '1' && sg.steps === '5' && sy.floors === '1' && sy.steps === '7', 'green: one floor of 5 steps; yellow: one floor of 7');
  check(so.floors === '2' && so.steps === '5,6' && sr.floors === '2' && sr.steps === '6,7' && sp.floors === '3' && sp.steps === '5,6', 'orange: two floors of 5 or 6 steps; red: two of 6 or 7; purple: three of 5 or 6');
  // Fights on every way through a whole dungeon, the boss and any elite included.
  const routeFights = (d) => { let lo = 0, hi = 0; for (const f of d.floors) { const by = new Map(f.rooms.map(r => [r.id, r])); let a = 99, b = 0; const walk = (r, n) => { n += DEFS.FIGHTS.includes(r.type) ? 1 : 0; if (!r.next.length) { a = Math.min(a, n); b = Math.max(b, n); return; } r.next.forEach(x => walk(by.get(x), n)); }; f.rooms.filter(r => r.step === 1).forEach(r => walk(r, 0)); lo += a; hi += b; } return [lo, hi]; };
  const span = (tier) => { let lo = 99, hi = 0; for (let s = 1; s <= 200; s++) { const [a, b] = routeFights(gen(s, tier, 'marsh')); lo = Math.min(lo, a); hi = Math.max(hi, b); } return lo + '-' + hi; };
  check(span('green') === '3-4' && span('yellow') === '3-5', 'fights on a way through, boss included: 3 or 4 at green (the table says 3), 3 to 5 at yellow (4)', span('green') + ' ' + span('yellow'));
  check(span('orange') === '5-8' && span('red') === '5-9' && span('purple') === '7-12', '5 to 8 at orange (the table says 6), 5 to 9 at red (7), 7 to 12 at purple (9): one fewer or one more on each floor, by the route taken', [span('orange'), span('red'), span('purple')].join(' '));
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
  check(every((f, d) => f.rooms.filter(r => r.type === 'boss').every(r => r.enemies.length === 3 && r.standin === true && r.boost.hp === 1) && !!d.clear.wealth), 'the boss has two companions and stands at the back; today a boosted stand-in, with a chest behind it');
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
  check(rr.find(r => r.type === 'boss').enemies[2] === 'old_greyfeather' && !rr.find(r => r.type === 'boss').boost && withReal.boss === 'an Old Greyfeather grown great and old' && rr.filter(r => r.type === 'elite').every(r => r.enemies.includes('stoat_captain') && !r.boost) && withReal.notes.standins === 0,
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

  // ── Class cards and decks (lib/class_cards.js, lib/dungeon_decks.js) ────
  console.log('Class cards');
  const CC = require('../lib/class_cards'), DK = require('../lib/dungeon_decks'), FM = require('../lib/card_formula');
  const badFormula = CC.allKeys().filter(k => FM.parseFormula(CC.card(k).formula).errors.length);
  check(Object.keys(CC.CARDS).length === 59 && CC.allKeys().length === 118 && badFormula.length === 0, 'every class card, and its honed form, has a formula the engine can read', badFormula.join());
  const size = d => Object.values(d).reduce((n, x) => n + x, 0);
  check(['guard', 'archer', 'wizard', 'hearthkeeper'].every(k => size(CC.PACKS[k].deck) === 10 && Object.keys(CC.PACKS[k].deck).every(c => CC.CARDS[c].cls === k)), 'each class pack is ten of its own cards');
  check(['guard', 'archer', 'wizard', 'hearthkeeper'].every(k => Object.keys(CC.PACKS[k].deck).filter(c => CC.CARDS[c].basic).length === 2 && Object.keys(CC.PACKS[k].deck).length === 5), 'two kinds of plain card and three of the class\'s own in every pack');
  const pk = role => CC.packFor({ role });
  check(pk('soldier').cls === 'guard' && pk('archer').cls === 'archer' && pk('wizard').cls === 'wizard' && pk('hearthkeeper').cls === 'hearthkeeper', 'a Guard, Archer, Wizard or Hearthkeeper takes the class pack');
  check(pk('farmer').cls === 'villager' && pk('farmer').deck.t_tool === 2 && pk('scout').deck.t_spot === 2 && pk('blacksmith').deck.t_shore === 2 && pk('porter').deck.t_ration === 2 && pk('tavernkeep').deck.t_drink === 2 && pk('scholar').deck.t_signs === 2
    && ['farmer', 'scout', 'blacksmith', 'porter', 'tavernkeep', 'scholar'].every(r => size(pk(r).deck) === 10), 'anyone else takes the Villager pack with two copies of their job\'s trade card');
  check(pk('idle').deck.v_swing === 6 && pk('idle').deck.v_duck === 4 && pk('idle').trade === null && size(pk(undefined).deck) === 10, 'a citizen with no job takes one more Swing and one more Duck');
  check(CC.card('g_strike_honed').formula === 'damage: (strength*0.7 + combat*0.8 + 5)*1.3' && CC.card('g_strike_honed').name === 'Strike ✦' && CC.card('g_strike_honed').cost === 1
    && CC.card('a_part_honed').formula === 'damage: (agility*0.5 + combat*0.6 + 3)*1.3\nblock: (agility*0.3 + 2)*1.3\nmove: 1', 'a honed card does about a third more; what it does besides stays as it was');
  check(CC.honedFormula('draw: 1\nenergy: 1').touched === false && CC.honedFormula('if target_species withered: damage: 4').formula === 'if target_species withered: damage: (4)*1.3', 'a condition is kept; a card with no numbers to raise costs one less instead');
  check(CC.honed('g_strike_honed') === 'g_strike_honed' && CC.baseOf('g_strike_honed') === 'g_strike' && CC.isClassCard('g_strike_honed') && !CC.isClassCard('strike'), 'a honed card knows the card it came from');
  check(Object.values(CC.CARDS).filter(c => c.heal).every(c => c.wither) && CC.CARDS.h_kindle.heal && CC.CARDS.t_ration.heal && CC.CARDS.c_second_wind.heal && !CC.CARDS.g_hold_line.heal, 'every healing card is marked as one, and cannot be played twice in a fight');
  // What can be offered.
  const pool = (cls, trade, owned, off) => CC.poolFor(cls, trade, new Set(owned || []), new Set(off || [])).sort().join();
  check(pool('guard', null) === 'g_cover,g_heavy,g_shove', 'with nothing unlocked a Guard is offered more of the pack\'s own class cards, never a plain Strike');
  check(pool('guard', null, ['g_stand_fast', 'g_shield_bash', 'a_aimed']) === 'g_cover,g_heavy,g_shield_bash,g_shove,g_stand_fast', 'what the town has unlocked for that class joins them, and no other class\'s cards');
  check(pool('villager', 't_tool') === 'c_cleave,c_expose,c_quick_jab,c_rally,c_weaken,t_tool', 'a villager is offered their trade card and the plain cards every town starts with');
  check(pool('guard', null, ['g_stand_fast'], ['g_stand_fast', 'g_cover']) === 'g_heavy,g_shove', 'a card that is not prepared is never offered');
  check(pool('guard', null, [], ['g_cover', 'g_heavy', 'g_shove']) === 'g_cover,g_heavy,g_shove', 'with everything set aside the pack\'s own cards are offered all the same');
  check(CC.isUnlock('g_stand_fast') && CC.isUnlock('g_shield_bash') && !CC.isUnlock('g_cover') && /Watchtower level 1/.test(CC.howTo('g_stand_fast')) && /Wizard's Tower level 3/.test(CC.howTo('w_fireball')), 'each unlock says how the town comes by it');
  // The deck through a run.
  const deck0 = { cards: { 1: { g_strike: 3, g_cover: 2 }, 2: { h_cinder: 3, h_kindle: 1 }, 3: { v_swing: 6 }, 4: { a_shoot: 3 } }, spent: {}, cls: { 1: 'guard', 2: 'hearthkeeper', 3: 'villager', 4: 'archer' }, trade: {} };
  const door = DK.doorOffers(deck0, [1, 2, 3, 4], 'seed|7', new Set(), new Set());
  check(door.kind === 'door' && [1, 3, 4].every(id => door.offers[id].length === 3 && new Set(door.offers[id]).size === 3) && door.offers[2].length === 2 && door.done.length === 0,
    'at the door every citizen is shown up to three different cards (a Hearthkeeper with nothing unlocked has two to show: not the heal already held)');
  check(JSON.stringify(door) === JSON.stringify(DK.doorOffers(deck0, [1, 2, 3, 4], 'seed|7', new Set(), new Set())) && JSON.stringify(door) !== JSON.stringify(DK.doorOffers(deck0, [1, 2, 3, 4], 'seed|8', new Set(), new Set())), 'the same dungeon and town always show the same cards');
  check(door.offers[1].every(k => CC.CARDS[k].cls === 'guard') && door.offers[4].every(k => CC.CARDS[k].cls === 'archer') && !door.offers[2].includes('h_kindle'), 'each is offered their own class\'s cards, and never a heal they already hold');
  let step = DK.pick(deck0, door, { citizen_id: 1, card: door.offers[1][0] });
  check(step.deck.cards[1][door.offers[1][0]] >= 1 && step.draft.done.join() === '1' && deck0.cards[1][door.offers[1][0]] !== step.deck.cards[1][door.offers[1][0]], 'keeping one adds it to that citizen\'s deck');
  const tryPick = (fn) => { try { fn(); return null; } catch (e) { return e.status; } };
  check(tryPick(() => DK.pick(step.deck, step.draft, { citizen_id: 1, card: door.offers[1][1] })) === 400 && tryPick(() => DK.pick(step.deck, step.draft, { citizen_id: 2, card: 'w_fireball' })) === 400, 'a second card for the same citizen, or a card that was not offered, is refused');
  step = DK.pick(step.deck, step.draft, { citizen_id: 2, card: null }); step = DK.pick(step.deck, step.draft, { citizen_id: 3, card: null }); step = DK.pick(step.deck, step.draft, { citizen_id: 4, card: null });
  check(step.draft === null, 'a citizen can pass; when all four have answered the door is done');
  const rew = DK.rewardOffers(deck0, [1, 2, 3, 4], 'seed|7', '0:a', new Set(), new Set());
  check(rew.kind === 'reward' && rew.offers.length === 3 && new Set(rew.offers.map(o => o.citizen)).size === 3 && rew.offers.every(o => CC.CARDS[o.card].cls === (deck0.cls[o.citizen] === 'villager' ? 'common' : deck0.cls[o.citizen]) || o.card.startsWith('t_')), 'after a fight: three cards, each for a different citizen, each of that citizen\'s class');
  const fought = { units: [{ id: 'p_2', side: 'player', citizen_id: 2 }, { id: 'p_1', side: 'player', citizen_id: 1 }], decks: { p_2: { withered: ['h_kindle'] }, p_1: { withered: ['g_hold_line'] } } };
  const afterFight = DK.spendHeals({ ...deck0, cards: { ...deck0.cards, 1: { g_strike: 3, g_hold_line: 1 } } }, fought);
  check(!afterFight.cards[2].h_kindle && afterFight.spent[2].join() === 'h_kindle' && afterFight.cards[1].g_hold_line === 1, 'a heal that was played is spent; a once-a-fight card that is not a heal comes back as usual');
  check(!DK.poolOf(afterFight, 2, new Set(), new Set()).includes('h_kindle') && !DK.forBattle(afterFight)[2].h_kindle, 'while spent it is not in the next fight, and is not offered again');
  check(DK.restore(afterFight).cards[2].h_kindle === 1 && DK.restore(afterFight).spent[2].length === 0, 'a rest brings it back');
  const honedDeck = DK.hone(deck0, 1, 'g_strike');
  check(honedDeck.cards[1].g_strike === 2 && honedDeck.cards[1].g_strike_honed === 1 && deck0.cards[1].g_strike === 3, 'honing changes one copy of a card into its honed form');
  check(tryPick(() => DK.hone(honedDeck, 1, 'g_strike_honed')) === 400 && tryPick(() => DK.hone(deck0, 1, 'a_shoot')) === 400 && tryPick(() => DK.hone(deck0, 9, 'g_strike')) === 400, 'a card already honed, a card not held, or a stranger is refused');
  const seen = DK.deckView(honedDeck, 1, f => 'does ' + f.length);
  check(seen.cls === 'guard' && seen.label === 'Guard' && seen.size === 5 && seen.cards[0].basic && seen.cards.find(c => c.key === 'g_strike_honed').honed && /^does /.test(seen.cards[0].text) && seen.cards.find(c => c.key === 'g_cover').reach === 'a friend', 'a deck for the screen: its class, its size, each card with what it does and whom it reaches');

  const CR = require('../lib/combat_resolver');
  let fatal = 0, fatalSafe = 0;
  for (let i = 0; i < 4000; i++) { if (CR.rollInjuryFor({}).severity === 'fatal') fatal++; if (CR.rollInjuryFor({ no_fatal: true }).severity === 'fatal') fatalSafe++; }
  check(fatal > 0 && fatalSafe === 0, 'the roll for a citizen who was stood back up has no fatal result');
  check(CR.combatModsOf({ enemy_health: 0.5, dungeon: { start: { 1: { hp: 5 } } } }).dungeon.start[1].hp === 5 && !CR.combatModsOf({ enemy_health: 0.5 }).dungeon,
    'a battle keeps its dungeon starting state with its other frozen modifiers');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  const D0 = require('../lib/dungeons');
  // Most checks below are about the path, not the cards: for them every card on offer is passed over.
  async function quiet(userId, r) {
    let v = r && r.run;
    for (let g = 0; v && v.status === 'active' && v.pending && (v.pending.kind === 'door' || v.pending.kind === 'reward') && g < 8; g++) {
      v = (await D0.pick(userId, v.pending.kind === 'door' ? { citizen_id: v.pending.citizens.find(c => !c.done).id, card: null } : { index: null })).run;
    }
    return { ...r, run: v };
  }
  const D = { ...D0 };
  for (const fn of ['startTest', 'startGenerated', 'start', 'adminWin']) D[fn] = async (userId, ...rest) => quiet(userId, await D0[fn](userId, ...rest));
  const CR = require('../lib/combat_resolver');
  const TU = require('../lib/tuning');
  let seq = 0;
  const X = -70000 - Math.floor(Math.random() * 5000) * 20;
  // A town with six adults (strong ones win every fight; weak ones lose).
  async function player(name, { strong = true } = {}) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [u.id, username, X + seq * 40])).rows[0];
    const stats = strong ? { strength: 40, agility: 14, endurance: 20, intelligence: 10, charisma: 10 } : { strength: 1, agility: 1, endurance: 1, intelligence: 1, charisma: 1 };
    const cits = [];
    for (let i = 0; i < 6; i++) cits.push((await q(
      `INSERT INTO citizens (settlement_id, name, gender, role, stats, skills, life_stage) VALUES ($1,$2,'female','idle',$3,$4,'adult') RETURNING id`,
      [s.id, `${name}${i}${RUN}`, JSON.stringify(stats), JSON.stringify({ combat: strong ? 8 : 1 })])).rows[0].id);
    return { id: u.id, sid: s.id, cits, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const runRow = async (p) => (await q('SELECT * FROM dungeon_runs WHERE settlement_id=$1 ORDER BY id DESC LIMIT 1', [p.sid])).rows[0];
  const wealth = async (p) => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  const have = async (p, item) => Number((await q('SELECT COALESCE(SUM(quantity),0)::int AS n FROM inventory_items WHERE settlement_id=$1 AND item_key=$2', [p.sid, item])).rows[0].n);
  // Play a fight through the real battle routes: every card that can be played
  // (aimed at the first creature standing), then end the turn.
  async function fight(p, questRunId, { cards = true } = {}) {
    let b = (await api(p, 'POST', '/api/combat/engage/' + questRunId)).body.battle;
    for (let guard = 0; b && b.status === 'active' && guard < 400; guard++) {
      let played = false;
      const hand = (cards && b.deck && b.deck.hand) || [];
      const foe = b.units.find(u => u.side === 'enemy' && u.hp > 0 && !u.flags.downed);
      const me = b.turn_order[b.current_index];
      for (let i = 0; i < hand.length && !played; i++) {
        // Aimed at the first creature standing; a card that is not for a creature is played on oneself.
        for (const target_id of [foe ? foe.id : null, me]) {
          const r = await api(p, 'POST', '/api/combat/action/' + questRunId, { action_key: 'card', hand_index: i, target_id });
          if (r.status === 200) { b = r.body.battle; played = true; break; }
        }
      }
      if (!played) {
        const r = await api(p, 'POST', '/api/combat/action/' + questRunId, { action_key: 'end_turn' });
        if (r.status !== 200) break;
        b = r.body.battle;
      }
    }
    return b;
  }

  await TU.setSwitch('dungeons.on', true);
  try {
    // ── Setting out ──────────────────────────────────────────────────────
    console.log('Setting out');
    const a = await player('Delve');
    let e = await D.startTest(a.id, 'test_green', a.cits.slice(0, 3)).catch(x => x);
    check(e.status === 400 && /exactly 4/.test(e.message), 'three citizens are refused: a dungeon takes exactly four');
    e = await D.startTest(a.id, 'test_green', a.cits.slice(0, 5)).catch(x => x);
    check(e.status === 400, 'five citizens are refused');
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
    check(v.status === 'active' && v.floor === 0 && v.room === null && v.moves.join() === 'a', 'the party stands at the door: the only way on is the first room');
    check(v.party.length === 4 && v.party.every(m => m.hp === m.max && m.max > 20 && !m.down), 'all four start at full health');
    check(v.dungeon.tier === 'green' && v.dungeon.floors === 1 && v.rooms.length === 8 && v.rooms.find(r => r.id === 'a').enemies.length === 3, 'the dungeon card: skull, floors, and the whole floor with what lives in each fight');
    check(!JSON.stringify(v.rooms).includes('timber_bundle') && v.rooms.every(r => !('loot' in r)), 'what a treasure room holds is not sent ahead');
    check(v.can_leave === true && v.can_flee === false && v.pending === null, 'between rooms the party may turn back, and there is nothing to flee');
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
    const q1 = r.body.quest_run_id;
    check(r.status === 200 && q1 && r.body.run.pending.kind === 'battle' && r.body.run.can_leave === false && r.body.run.can_flee === true, 'entering a fight room opens a battle; now the party can only win, lose or flee');
    let b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [q1])).rows[0];
    check(b.dungeon_run_id === v.id && b.quest_id === 'dungeon_room' && b.auto_resolve_combat === false && b.combat_status === 'pending', 'the battle is an ordinary battle row that names its run, played by hand');
    check(b.combat_mods.enemy_health === 0.5 && b.combat_mods.enemy_strength === 0.4 && b.combat_mods.enemy_agility === 0.2, "the skull's modifiers are frozen on the battle: +50% health, +40% strength, +20% agility");
    check(Number(b.combat_seed) === require('../lib/dungeon_defs').battleSeed((await q('SELECT seed FROM dungeons WHERE id=$1', [(await runRow(a)).dungeon_id])).rows[0].seed, a.sid, 0, 'a'), 'its seed comes from the dungeon, the town and the room');
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    check(r.status === 400 && /Finish the fight/.test(r.body.error), 'no walking on while the fight is open');
    r = await api(a, 'POST', '/api/dungeons/run/leave');
    check(r.status === 400, 'no turning back in the middle of a fight');
    const eng = (await api(a, 'POST', '/api/combat/engage/' + q1)).body;
    check(eng.dungeon_run_id === v.id, 'the battle screen is told this fight belongs to a dungeon run');
    const wolf = eng.battle.units.find(u => u.enemy_key === 'night_wolf'), wolfBase = Number((await q("SELECT max_hp FROM enemy_definitions WHERE id='night_wolf'")).rows[0].max_hp);
    check(wolf && wolf.maxHp === Math.round(wolfBase * 1.5), `a Night Wolf has ${Math.round(wolfBase * 1.5)} health in a green dungeon (${wolfBase} outside)`);
    const w0 = await wealth(a);
    const end = await fight(a, q1);
    check(end && end.status === 'victory', 'the party wins the fight');
    r = await api(a, 'POST', '/api/combat/resolve', { quest_run_id: q1, outcome: 'victory' });
    v = r.body.dungeon && r.body.dungeon.run;
    check(r.status === 200 && r.body.outcome === 'victory' && v && v.status === 'active' && v.room === 'a' && !v.room_open, 'after the win the party is back on the path');
    check(v.pending && v.pending.kind === 'reward' && v.pending.offers.length === 3 && new Set(v.pending.offers.map(o => o.citizen)).size === 3 && v.moves.length === 0,
      'first three cards are offered, each for a different citizen, and the way on waits');
    const moveEarly = await api(a, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    check(moveEarly.status === 400 && /Choose a card from the fight/.test(moveEarly.body.error), 'no walking on until a card is kept or passed over');
    const offer0 = v.pending.offers[0], sizeBefore = v.party.find(m => m.id === offer0.citizen).deck.size;
    const took = await api(a, 'POST', '/api/dungeons/run/pick', { index: 0 });
    v = took.body.run;
    check(took.status === 200 && took.body.took.card.key === offer0.card.key && v.party.find(m => m.id === offer0.citizen).deck.size === sizeBefore + 1 && v.pending === null && v.moves.join() === 'b1,b2',
      'keeping one adds it to that citizen\'s deck, and there are two ways on');
    check((await api(a, 'POST', '/api/dungeons/run/pick', { index: 1 })).status === 400, 'only one of the three can be kept');
    const hpEnd = Object.fromEntries(end.units.filter(u => u.side === 'player').map(u => [u.citizen_id, u.hp]));
    check(v.party.every(m => m.hp === hpEnd[m.id]), "each citizen's health on the path is their health at the end of the fight");
    check(v.loot.wealth === Math.round(end.reward.wealth * 0.2) && v.loot.wealth > 0 && (await wealth(a)) === w0, 'the wealth found is held by the run, not paid yet');
    check(r.body.dungeon.found.wealth === v.loot.wealth && r.body.dungeon.ended === false, 'the answer says what this fight gave');
    b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [q1])).rows[0];
    check(b.status === 'collected' && b.combat_status === 'resolved' && b.combat_outcome === 'victory', 'the battle row is closed: nothing for the quest board to settle');
    check((await q("SELECT COUNT(*)::int AS n FROM citizen_events WHERE settlement_id=$1 AND event_type='injury'", [a.sid])).rows[0].n === 0, 'no injury is rolled after a room');
    r = await api(a, 'POST', '/api/combat/resolve', { quest_run_id: q1, outcome: 'victory' });
    check(r.status === 400 && (await runRow(a)).loot.wealth === v.loot.wealth, 'resolving the same fight twice gives nothing more');
    const rep = async () => (await CR.replayBattle({ citizenIds: party, enemyKeys: b.combat_encounter, seed: Number(b.combat_seed), actions: b.combat_actions, settlementId: a.sid, mods: b.combat_mods })).battle;
    const r1 = await rep(), r2 = await rep();
    check(r1.status === 'victory' && JSON.stringify(r1.units.map(u => [u.id, u.hp])) === JSON.stringify(r2.units.map(u => [u.id, u.hp])) && r1.units.filter(u => u.side === 'player').every(u => u.hp === hpEnd[u.citizen_id]),
      'the stored battle replays to exactly the same result');

    // ── The next fight starts from those wounds ─────────────────────────
    const st = (await runRow(a)).party_state;
    st[party[0]] = { ...st[party[0]], hp: 7 };
    st[party[1]] = { ...st[party[1]], hp: 0, down: true, was_down: true };
    await q('UPDATE dungeon_runs SET party_state=$2 WHERE id=$1', [v.id, JSON.stringify(st)]);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'b2' });
    const q2 = r.body.quest_run_id;
    const eng2 = (await api(a, 'POST', '/api/combat/engage/' + q2)).body.battle;
    const u0 = eng2.units.find(u => u.citizen_id === party[0]), u1 = eng2.units.find(u => u.citizen_id === party[1]), u2 = eng2.units.find(u => u.citizen_id === party[2]);
    check(u0.hp === 7 && u0.maxHp > 7 && u2.hp === st[party[2]].hp, 'a wounded citizen walks into the next fight with the health they had');
    check(u1.hp === 0 && u1.flags.downed === true && !eng2.turn_order.includes(u1.id), 'a downed citizen is brought along, lying at 0 health, and takes no turn');
    check(eng2.status === 'active', 'the fight goes on with the three who are standing');
    const won = await D.adminWin(a.id);
    v = won.run;
    check(v.party.find(m => m.id === party[1]).down && v.party.find(m => m.id === party[1]).was_down && v.party.find(m => m.id === party[0]).hp === 7, 'after the fight she is still down; nothing heals between rooms by itself');

    // ── Rest, treasure, boss ────────────────────────────────────────────
    console.log('Rest, treasure and the boss');
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    check(r.status === 400, 'nothing to decide outside a rest room');
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'c2' });
    check(r.status === 200 && r.body.run.pending.kind === 'rest' && r.body.run.pending.options.some(o => o.key === 'rest') && r.body.run.moves.length === 0, 'a rest room asks before the party walks on');
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'deeper' });
    check(r.status === 400, 'an answer that is not offered is refused');
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    v = r.body.run;
    const m0 = v.party.find(m => m.id === party[0]), m1 = v.party.find(m => m.id === party[1]);
    check(m0.hp === 7 + Math.round(m0.max * 0.3) && m1.down === false && m1.hp === Math.round(m1.max * 0.3) && m1.was_down === true, 'resting gives back 30% and stands the downed citizen up with it');
    check(v.moves.join() === 'd2' && !v.room_open, 'then the way on is open');
    const lootBefore = v.loot.wealth, qtyOf = (run, k) => (run.loot.items.find(i => i.item === k) || { qty: 0 }).qty;
    const timberHeld = qtyOf(v, 'timber_bundle');   // a creature may have dropped some already
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'd2' });
    v = r.body.run;
    check(r.body.found.wealth === 15 && r.body.found.items[0].item_key === 'timber_bundle' && v.loot.wealth === lootBefore + 15 && qtyOf(v, 'timber_bundle') === timberHeld + 2 && !v.room_open,
      'a treasure room adds its find to the run loot, with no fight');
    const sap0 = await have(a, 'rare_sap'), timber0 = await have(a, 'timber_bundle'), w1 = await wealth(a);
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'boss' });
    check(r.body.run.pending.room === 'boss', 'the last room is the boss');
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
    const tw = await wealth(t), th = await have(t, 'hide'), held = (await runRow(t)).loot;
    r = await api(t, 'POST', '/api/dungeons/run/leave');
    v = r.body.run;
    check(r.status === 200 && v.status === 'left' && v.result.kept.wealth === held.wealth && (await wealth(t)) === tw + held.wealth && (await have(t, 'hide')) === th + qtyOf(v, 'hide') && qtyOf(v, 'hide') >= 2, 'turning back keeps everything found so far');
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
    await q(`UPDATE dungeon_runs SET loot = jsonb_set(loot, '{wealth}', '41') WHERE settlement_id=$1 AND status='active'`, [f.sid]);
    const fs = (await runRow(f)).party_state;
    fs[fp[2]] = { ...fs[fp[2]], was_down: true };          // went down earlier and was stood back up
    await q(`UPDATE dungeon_runs SET party_state=$2 WHERE settlement_id=$1 AND status='active'`, [f.sid, JSON.stringify(fs)]);
    r = await api(f, 'POST', '/api/dungeons/run/move', { room: 'c1' });
    const q3 = r.body.quest_run_id;
    const fw = await wealth(f), fh = await have(f, 'hide');
    r = await api(f, 'POST', '/api/dungeons/run/flee');
    v = r.body.run;
    check(r.status === 200 && v.status === 'fled' && v.result.half === true, 'fleeing a fight ends the run');
    check(v.result.kept.wealth === 20 && v.result.lost.wealth === 21 && (await wealth(f)) === fw + 20 && (await have(f, 'hide')) === fh + 1 && v.result.lost.items.find(i => i.item_key === 'hide').qty === 1,
      'half the wealth and half of each kind of item is kept; the rest is dropped');
    check(v.result.rolled.length === 1 && v.result.rolled[0].id === fp[2] && v.result.rolled[0].no_fatal === true, 'only those who went down roll');
    b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [q3])).rows[0];
    check(b.status === 'collected' && b.combat_outcome === 'defeat' && (await D.busyCitizenIds(fp)).length === 0, 'the fight is closed and the party is home');
    // The Battles list's forfeit button does the same for a dungeon fight.
    const f2 = await player('Forfeit');
    await D.startTest(f2.id, 'test_green', f2.cits.slice(0, 4));
    r = await api(f2, 'POST', '/api/dungeons/run/move', { room: 'a' });
    r = await api(f2, 'POST', '/api/combat/forfeit/' + r.body.quest_run_id);
    check(r.status === 200 && r.body.dungeon.run.status === 'fled', "forfeiting a dungeon fight from the Battles list is fleeing");

    // ── Defeat ──────────────────────────────────────────────────────────
    console.log('Defeat');
    const l = await player('Lost', { strong: false });
    const lp = l.cits.slice(0, 4);
    await D.startTest(l.id, 'test_green', lp);
    await q(`UPDATE dungeon_runs SET loot = '{"wealth": 50, "items": [{"item": "hide", "qty": 4}]}' WHERE settlement_id=$1 AND status='active'`, [l.sid]);
    r = await api(l, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const q4 = r.body.quest_run_id;
    const lw = await wealth(l), lh = await have(l, 'hide');
    const lostFight = await fight(l, q4, { cards: false });
    check(lostFight && lostFight.status === 'defeat', 'four weak villagers who never play a card lose the fight');
    r = await api(l, 'POST', '/api/combat/resolve', { quest_run_id: q4, outcome: 'victory' });
    v = r.body.dungeon.run;
    check(r.body.outcome === 'defeat' && v.status === 'defeat' && r.body.dungeon.ended === true, "a lost battle ends the run in defeat, whatever the client claims");
    check(v.result.kept.wealth === 0 && v.result.kept.items.length === 0 && v.result.lost.wealth === 50 && (await wealth(l)) === lw && (await have(l, 'hide')) === lh, 'all the loot from the run is lost');
    check(v.result.rolled.length === 4 && v.result.rolled.every(x => x.no_fatal === false) && lp.every(id => v.result.rolled.some(x => x.id === id)), 'every citizen in the party rolls on the full injury table');
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
    const q5 = r.body.quest_run_id;
    await api(i2, 'POST', '/api/combat/engage/' + q5);
    await q(`UPDATE dungeon_runs SET last_action_at = NOW() - interval '25 hours' WHERE settlement_id=$1 AND status='active'`, [i2.sid]);
    r = await api(i2, 'POST', '/api/combat/engage/' + q5);
    check(new Date((await runRow(i2)).last_action_at) > new Date(Date.now() - 60000), 'opening the fight again counts as an action: the run is not idle');
    await q(`UPDATE dungeon_runs SET last_action_at = NOW() - interval '25 hours' WHERE settlement_id=$1 AND status='active'`, [i2.sid]);
    const i2w = await wealth(i2);
    await D.sweep();
    row = await runRow(i2);
    check(row.status === 'timed_out' && row.result.half === true && row.result.kept.wealth === 20 && (await wealth(i2)) === i2w + 20, 'idle in the middle of a fight costs what fleeing costs: half the loot, never a defeat');
    check((await q('SELECT status, combat_outcome FROM settlement_quests WHERE id=$1', [q5])).rows[0].status === 'collected', 'and the open battle is closed');

    // ── Two floors and a landing ────────────────────────────────────────
    console.log('Two floors');
    const o = await player('Deep');
    v = (await D.startTest(o.id, 'test_orange', o.cits.slice(0, 4))).run;
    check(v.dungeon.tier === 'orange' && v.dungeon.floors === 2, 'an orange dungeon with two floors');
    r = await api(o, 'POST', '/api/dungeons/run/move', { room: 'a' });
    b = (await q('SELECT combat_mods FROM settlement_quests WHERE id=$1', [r.body.quest_run_id])).rows[0];
    check(b.combat_mods.enemy_health === 1.25 && b.combat_mods.enemy_strength === 1, 'orange creatures: +125% health, +100% strength');
    await D.adminWin(o.id);
    await api(o, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    r = await api(o, 'POST', '/api/dungeons/run/move', { room: 'c1' });
    b = (await q('SELECT combat_mods FROM settlement_quests WHERE id=$1', [r.body.quest_run_id])).rows[0];
    check(r.body.run.pending.room === 'elite' && b.combat_mods.enemy_health === 1.75, "an elite room's own boost is added to the skull's");
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
      await q('DELETE FROM dungeons WHERE id=$1', [row.id]);
    }
    check(true, 'a dungeon as stored only ever names items this database has');
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
      const made = GEN.generate({ seed: 1234, tier, terrain: land, creatures: (await q('SELECT id, name, max_hp, biomes, archived FROM enemy_definitions WHERE archived = FALSE')).rows });
      const sameRooms = JSON.stringify(v.rooms.map(x => [x.id, x.type, x.next, x.enemies.map(en => en.key)])) === JSON.stringify(made.floors[0].rooms.map(x => [x.id, x.type, x.next, x.enemies || []]));
      const gw = await wealth(gp);
      const done = await walk(gp);
      const steps = made.floors.reduce((n, f) => n + Math.max(...f.rooms.map(x => x.step)), 0);
      check(v.dungeon.generated && v.dungeon.tier === tier && v.dungeon.name === made.name && v.dungeon.seed === 1234 && sameRooms && done.view.status === 'cleared' && done.rooms === steps
        && done.view.result.kept.wealth >= made.clear.wealth && (await wealth(gp)) === gw + done.view.result.kept.wealth,
        `a generated ${tier} ${land} dungeon (${made.name}, ${made.floors.length} floor${made.floors.length === 1 ? '' : 's'}) plays from the door to the boss chest`, `${done.view.status}, ${done.rooms} of ${steps} rooms`);
    }
    // One dungeon, two towns: the same rooms, different card draws.
    const shared = await D.createGenerated({ tier: 'green', terrain: 'forest', seed: 99, source: 'test' });
    const t1 = await player('Twin'), t2 = await player('Twin');
    const v1 = (await D.start(t1.id, shared.id, t1.cits.slice(0, 4))).run, v2 = (await D.start(t2.id, shared.id, t2.cits.slice(0, 4))).run;
    check(JSON.stringify(v1.rooms) === JSON.stringify(v2.rooms) && v1.dungeon.name === v2.dungeon.name, 'two towns in the same dungeon see the same rooms');
    const b1 = (await api(t1, 'POST', '/api/dungeons/run/move', { room: v1.moves[0] })).body.quest_run_id, b2 = (await api(t2, 'POST', '/api/dungeons/run/move', { room: v2.moves[0] })).body.quest_run_id;
    const seeds = (await q('SELECT combat_seed, combat_encounter FROM settlement_quests WHERE id = ANY($1::int[]) ORDER BY id', [[b1, b2]])).rows;
    check(JSON.stringify(seeds[0].combat_encounter) === JSON.stringify(seeds[1].combat_encounter) && String(seeds[0].combat_seed) !== String(seeds[1].combat_seed), 'and meet the same creatures there, with their own card draws');
    await q(`UPDATE enemy_definitions SET archived = TRUE WHERE id = 'night_wolf'`);
    const again = (await api(t1, 'GET', '/api/dungeons/run')).body.run;
    await q(`UPDATE enemy_definitions SET archived = FALSE WHERE id = 'night_wolf'`);
    check(JSON.stringify(again.rooms.map(x => [x.id, x.type, x.enemies.map(en => en.key)])) === JSON.stringify(v1.rooms.map(x => [x.id, x.type, x.enemies.map(en => en.key)])), 'a later change to the creature list does not change a dungeon already made');
    await api(t1, 'POST', '/api/dungeons/run/flee'); await api(t2, 'POST', '/api/dungeons/run/flee');

    // ── Class decks ─────────────────────────────────────────────────────
    console.log('Class decks');
    const CC = require('../lib/class_cards'), CARDS = require('../lib/cards');
    const seeded = (await q("SELECT card_key, metadata FROM card_templates WHERE card_key = ANY($1::text[])", [CC.allKeys()])).rows;
    check(seeded.length === 118 && seeded.every(x => x.metadata.dungeon === true), 'the class cards and their honed forms are in the card table, marked as class-deck cards');
    await require('../routes/cards');   // (loads the registry helpers)
    await CR.replayBattle({ citizenIds: a.cits.slice(0, 1), enemyKeys: ['marsh_rat'], seed: 1, actions: [], settlementId: a.sid, mods: null }).catch(() => {});
    check(!CARDS.unlockable().some(k => CC.isClassCard(k)), 'they are never dropped, taught or won as home cards');
    r = await api(a, 'GET', '/api/cards');
    check(r.status === 200 && !r.body.cards.some(c => CC.isClassCard(c.key)), 'and the home collection does not list them');
    // A party of a Guard, an Archer, a Porter and a Farmer. The Watchtower at level 2, and an old Shield Bash, unlock Guard cards.
    const k = await player('Decks');
    const [gd, ar, po, fa] = k.cits;
    await q("UPDATE citizens SET role='soldier' WHERE id=$1", [gd]); await q("UPDATE citizens SET role='archer' WHERE id=$1", [ar]);
    await q("UPDATE citizens SET role='porter', stats = stats || '{\"charisma\": 13}' WHERE id=$1", [po]); await q("UPDATE citizens SET role='farmer' WHERE id=$1", [fa]);
    await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'watchtower',2)", [k.sid]);
    await q("INSERT INTO settlement_unlocked_cards (settlement_id, card_key, source) VALUES ($1,'shield_bash','test')", [k.sid]);
    const ownedK = await CC.ownedFor(k.sid);
    check(['g_stand_fast', 'g_oath', 'a_aimed', 'a_pin', 'g_shield_bash'].every(x => ownedK.has(x)) && !ownedK.has('g_hammer') && !ownedK.has('w_fireball') && !ownedK.has('g_bulwark'),
      'a Watchtower at level 2 owns the level 1 and 2 cards of Guard and Archer; an old Shield Bash owns its Guard twin');
    r = await api(k, 'GET', '/api/dungeons/cards');
    const guardCards = r.body.classes.find(c => c.cls === 'guard');
    check(r.status === 200 && r.body.classes.map(c => c.cls).join() === 'guard,archer,wizard,hearthkeeper,villager' && guardCards.pack.length === 5 && guardCards.pack.reduce((n, c) => n + c.n, 0) === 10
      && guardCards.more.find(c => c.key === 'g_stand_fast').owned && !guardCards.more.find(c => c.key === 'g_hammer').owned && /Watchtower level 3/.test(guardCards.more.find(c => c.key === 'g_hammer').how)
      && r.body.classes.find(c => c.cls === 'villager').trades.length === 6, 'the class cards screen: each class with its pack, what is unlocked and how to get the rest');
    r = await api(k, 'POST', '/api/dungeons/cards/prepare', { card: 'g_cover', prepared: false });
    check(r.status === 200 && r.body.classes.find(c => c.cls === 'guard').pack.find(c => c.key === 'g_cover').prepared === false, 'a card can be set aside');
    check((await api(k, 'POST', '/api/dungeons/cards/prepare', { card: 'g_strike', prepared: false })).status === 400 && (await api(k, 'POST', '/api/dungeons/cards/prepare', { card: 'strike', prepared: false })).status === 400, 'a plain card, or a card that is not a class card, cannot');
    for (const x of ['g_heavy', 'g_shove', 'g_stand_fast', 'g_shield_bash']) await api(k, 'POST', '/api/dungeons/cards/prepare', { card: x, prepared: false });
    // The door.
    v = (await D0.startTest(k.id, 'test_green', [gd, ar, po, fa])).run;
    const byId = id => v.party.find(m => m.id === id);
    check(byId(gd).deck.cls === 'guard' && byId(gd).deck.size === 10 && byId(ar).deck.cls === 'archer' && byId(po).deck.cls === 'villager' && byId(po).deck.cards.find(c => c.key === 't_ration').n === 2 && byId(fa).deck.cards.find(c => c.key === 't_tool').n === 2,
      'each citizen walks in with their own ten cards: the class pack, or the Villager pack with their trade card');
    check(/^Deal \d+ damage$/.test(byId(gd).deck.cards.find(c => c.key === 'g_strike').text) && byId(gd).deck.cards.find(c => c.key === 'g_strike').reach === 'the front creature', "each card shows what it does in that citizen's hands");
    check(v.pending.kind === 'door' && v.pending.citizens.length === 4 && v.pending.citizens.every(c => c.cards.length >= 1 && c.cards.length <= 3 && !c.done) && v.moves.length === 0, 'at the door a choice of cards waits for each of the four');
    const gOffer = v.pending.citizens.find(c => c.id === gd).cards.map(c => c.key);
    check(gOffer.length === 1 && gOffer[0] === 'g_oath', 'the Guard is offered only what is prepared: with the rest set aside, the one unlocked card left', gOffer.join());
    check(v.pending.citizens.find(c => c.id === ar).cards.every(c => CC.CARDS[c.key].cls === 'archer') && v.pending.citizens.find(c => c.id === po).cards.every(c => ['common', 'trade'].includes(CC.CARDS[c.key].cls)), "an Archer sees Archer cards; a villager the plain cards and their trade's");
    r = await api(k, 'POST', '/api/dungeons/run/move', { room: 'a' });
    check(r.status === 400 && /Choose a card for each citizen/.test(r.body.error), 'no walking in until each citizen has kept a card or passed');
    r = await api(k, 'POST', '/api/dungeons/run/pick', { citizen_id: gd, card: 'g_hammer' });
    check(r.status === 400, 'a card that was not offered is refused');
    r = await api(k, 'POST', '/api/dungeons/run/pick', { citizen_id: gd, card: 'g_oath' });
    check(r.status === 200 && r.body.took.card.name === "Guard's Oath" && r.body.run.party.find(m => m.id === gd).deck.size === 11 && r.body.run.pending.citizens.find(c => c.id === gd).done === true, 'the Guard keeps one: eleven cards now');
    check((await api(k, 'POST', '/api/dungeons/run/pick', { citizen_id: gd, card: 'g_oath' })).status === 400, 'one card each');
    const reload = (await api(k, 'GET', '/api/dungeons/run')).body.run;
    check(JSON.stringify(reload.pending.citizens.find(c => c.id === ar).cards.map(c => c.key)) === JSON.stringify(v.pending.citizens.find(c => c.id === ar).cards.map(c => c.key)), 'reloading shows the same cards');
    await api(k, 'POST', '/api/dungeons/run/pick', { citizen_id: ar, card: null });
    await api(k, 'POST', '/api/dungeons/run/pick', { citizen_id: po, card: null });
    r = await api(k, 'POST', '/api/dungeons/run/pick', { citizen_id: fa, card: null });
    v = r.body.run;
    check(v.pending === null && v.moves.join() === 'a' && v.party.find(m => m.id === ar).deck.size === 10, 'the others pass; the way in is open');
    // The fight: one deck apiece. (The Porter is left with his two Share Rations only, so that he is sure to play one.)
    await q(`UPDATE dungeon_runs SET deck = jsonb_set(deck, $2, '{"t_ration": 2}') WHERE settlement_id=$1 AND status='active'`, [k.sid, `{cards,${po}}`]);
    r = await api(k, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const qk = r.body.quest_run_id;
    b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [qk])).rows[0];
    check(b.combat_mods.dungeon.decks[gd].g_oath === 1 && b.combat_mods.dungeon.decks[gd].g_strike === 3 && Object.keys(b.combat_mods.dungeon.decks).length === 4 && b.combat_mods.dungeon.decks[po].t_ration === 2, "each citizen's deck is frozen on the battle");
    let bt = (await api(k, 'POST', '/api/combat/engage/' + qk)).body.battle;
    const unitOf = cid => bt.units.find(u => u.citizen_id === cid);
    check(Object.keys(bt.decks).length === 4 && [gd, ar, fa].every(cid => { const dk = bt.decks[unitOf(cid).id]; return dk.hand.length === 5 && dk.hand.concat(dk.drawPile).length === (cid === gd ? 11 : 10); })
      && bt.decks[unitOf(po).id].hand.length === 2, 'the battle holds four decks, each with a hand of up to five');
    const mineOnly = (cid) => { const dk = bt.decks[unitOf(cid).id], own = Object.keys(b.combat_mods.dungeon.decks[cid]); return dk.hand.concat(dk.drawPile, dk.discardPile).every(c => own.includes(c)); };
    check([gd, ar, po, fa].every(mineOnly), "and holds only that citizen's cards");
    const actor0 = bt.units.find(u => u.id === bt.turn_order[bt.current_index]);
    check(actor0.side === 'player' && JSON.stringify(bt.deck.hand) === JSON.stringify(bt.decks[actor0.id].hand), "the hand on screen is the acting citizen's own");
    check(unitOf(po).charisma === 13, 'charisma reaches the battle in a dungeon');
    // Play it: every card that can be played, the Porter's Share Rations among them.
    await q("UPDATE dungeon_runs SET party_state = jsonb_set(party_state, $2, '20') WHERE settlement_id=$1 AND status='active'", [k.sid, `{${fa},hp}`]);
    const hands = new Set();
    let endK = bt;
    for (let g = 0; endK.status === 'active' && g < 300; g++) {
      const me = endK.units.find(u => u.id === endK.turn_order[endK.current_index]);
      const own = Object.keys(b.combat_mods.dungeon.decks[me.citizen_id]);
      if (!endK.deck.hand.every(c => own.includes(c))) hands.add('wrong');
      const foe = endK.units.find(u => u.side === 'enemy' && u.hp > 0 && !u.flags.downed);
      let played = false;
      for (let i = 0; i < endK.deck.hand.length && !played; i++) for (const target_id of [foe ? foe.id : null, me.id]) {
        const rr = await api(k, 'POST', '/api/combat/action/' + qk, { action_key: 'card', hand_index: i, target_id });
        if (rr.status === 200) { endK = rr.body.battle; played = true; break; }
      }
      if (!played) endK = (await api(k, 'POST', '/api/combat/action/' + qk, { action_key: 'end_turn' })).body.battle;
    }
    check(endK.status === 'victory' && !hands.has('wrong'), "the fight is won, and on every turn the hand held only the acting citizen's cards");
    const poDeck = endK.decks[endK.units.find(u => u.citizen_id === po).id];
    check(poDeck.withered.includes('t_ration'), 'the Porter played Share Rations (a heal cannot be played twice in a fight)');
    b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [qk])).rows[0];
    const rp1 = (await CR.replayBattle({ citizenIds: [gd, ar, po, fa], enemyKeys: b.combat_encounter, seed: Number(b.combat_seed), actions: b.combat_actions, settlementId: k.sid, mods: b.combat_mods })).battle;
    check(rp1.status === 'victory' && JSON.stringify(rp1.units.map(u => [u.id, u.hp])) === JSON.stringify(endK.units.map(u => [u.id, u.hp])), 'the stored battle replays to exactly the same result, decks and all');
    r = await api(k, 'POST', '/api/combat/resolve', { quest_run_id: qk, outcome: 'victory' });
    v = r.body.dungeon.run;
    const spentN = poDeck.withered.filter(c => c === 't_ration').length;
    check(v.party.find(m => m.id === po).deck.spent.length === spentN && spentN >= 1 && (v.party.find(m => m.id === po).deck.cards.find(c => c.key === 't_ration') || { n: 0 }).n === 2 - spentN, 'the heal he played is spent: out of his deck until the party rests', `played ${spentN}`);
    check(v.pending.kind === 'reward' && v.pending.can_hone === true && !v.pending.offers.some(o => o.citizen === po && o.card.key === 't_ration' && spentN === 2), 'then the reward is offered: a card, or a hone in its place');
    await api(k, 'POST', '/api/dungeons/run/pick', { index: null });
    r = await api(k, 'POST', '/api/dungeons/run/move', { room: 'b2' });
    b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [r.body.quest_run_id])).rows[0];
    check((b.combat_mods.dungeon.decks[po].t_ration || 0) === 2 - spentN, 'and it is not in his deck for the next fight');
    const emptyHanded = (await api(k, 'POST', '/api/combat/engage/' + r.body.quest_run_id)).body.battle;
    const poNow = emptyHanded.decks[emptyHanded.units.find(u => u.citizen_id === po).id];
    check(spentN < 2 || (poNow.hand.length === 0 && poNow.drawPile.length === 0), 'a citizen with nothing left to play has an empty hand of their own, never someone else\'s');
    await D0.adminWin(k.id);
    // After a fight: hone a card in place of taking one.
    check((await api(k, 'POST', '/api/dungeons/run/pick', { hone: { citizen_id: ar, card: 'g_strike' } })).status === 400, 'a hone in place of the card needs a card that citizen holds');
    r = await api(k, 'POST', '/api/dungeons/run/pick', { hone: { citizen_id: ar, card: 'a_shoot' } });
    const aDeck = r.body.run.party.find(m => m.id === ar).deck;
    check(r.status === 200 && r.body.took && r.body.took.honed === true && r.body.took.card.key === 'a_shoot_honed' && aDeck.size === 10 && aDeck.cards.find(c => c.key === 'a_shoot_honed').n === 1 && aDeck.cards.find(c => c.key === 'a_shoot').n === 2 && r.body.run.pending === null,
      'the Archer hones a Shoot in place of the card: no card is added and the way on opens');
    // A rest room: the party rests, and hones a card.
    r = await api(k, 'POST', '/api/dungeons/run/move', { room: 'c2' });
    v = r.body.run;
    check(v.pending.kind === 'rest' && v.pending.options.map(o => o.key).join() === 'hone,rest' && v.pending.options[0].needs === 'card', 'a rest room offers a rest with a card honed, or a rest alone');
    const hurtBefore = v.party.map(m => m.hp);
    check((await api(k, 'POST', '/api/dungeons/run/choose', { option: 'hone', citizen_id: gd, card: 'a_shoot' })).status === 400 && (await api(k, 'POST', '/api/dungeons/run/choose', { option: 'hone' })).status === 400, 'honing needs a card that citizen holds');
    r = await api(k, 'POST', '/api/dungeons/run/choose', { option: 'hone', citizen_id: gd, card: 'g_strike' });
    v = r.body.run;
    const gDeck = v.party.find(m => m.id === gd).deck;
    check(r.status === 200 && gDeck.cards.find(c => c.key === 'g_strike').n === 2 && gDeck.cards.find(c => c.key === 'g_strike_honed').n === 1 && gDeck.cards.find(c => c.key === 'g_strike_honed').honed && gDeck.size === 11 && !v.room_open, 'one Strike is honed, and the party walks on');
    const plain = parseInt(gDeck.cards.find(c => c.key === 'g_strike').text.match(/\d+/)[0], 10), sharp = parseInt(gDeck.cards.find(c => c.key === 'g_strike_honed').text.match(/\d+/)[0], 10);
    check(sharp === Math.round(plain * 1.3) || Math.abs(sharp - plain * 1.3) <= 1, `the honed Strike hits for about a third more (${plain} → ${sharp})`);
    check(v.party.find(m => m.id === po).deck.spent.length === 0 && (v.party.find(m => m.id === po).deck.cards.find(c => c.key === 't_ration') || {}).n === 2
      && v.party.every((m, i) => m.hp >= hurtBefore[i] && !m.down) && v.party.some((m, i) => m.hp > hurtBefore[i] || m.hp === m.max), 'the party rested as well: health is back, and so is the spent heal');
    r = await api(k, 'POST', '/api/dungeons/run/move', { room: 'd2' });
    r = await api(k, 'POST', '/api/dungeons/run/move', { room: 'boss' });
    b = (await q('SELECT * FROM settlement_quests WHERE id=$1', [r.body.quest_run_id])).rows[0];
    check(b.combat_mods.dungeon.decks[gd].g_strike_honed === 1 && b.combat_mods.dungeon.decks[gd].g_strike === 2, 'the honed card goes into the next fight');
    const bossWin = await D0.adminWin(k.id);
    check(bossWin.ended && bossWin.run.status === 'cleared' && bossWin.run.pending === null, 'no reward after the boss: the run is over');
    // A rest brings spent heals back.
    const h2 = await player('Heals');
    await q("UPDATE citizens SET role='porter' WHERE id=$1", [h2.cits[0]]);
    await D.startTest(h2.id, 'test_green', h2.cits.slice(0, 4));
    await api(h2, 'POST', '/api/dungeons/run/move', { room: 'a' }); await D.adminWin(h2.id);
    await api(h2, 'POST', '/api/dungeons/run/move', { room: 'b2' }); await D.adminWin(h2.id);
    await q(`UPDATE dungeon_runs SET deck = jsonb_set(jsonb_set(deck, $2, '1'), $3, '["t_ration"]') WHERE settlement_id=$1 AND status='active'`, [h2.sid, `{cards,${h2.cits[0]},t_ration}`, `{spent,${h2.cits[0]}}`]);
    await api(h2, 'POST', '/api/dungeons/run/move', { room: 'c2' });
    r = await api(h2, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    const hd = r.body.run.party.find(m => m.id === h2.cits[0]).deck;
    check(hd.spent.length === 0 && hd.cards.find(c => c.key === 't_ration').n === 2, 'resting brings every spent heal back');
    await api(h2, 'POST', '/api/dungeons/run/leave');
    // A battle that is not in a dungeon still uses the town's one deck.
    const plainBattle = (await CR.replayBattle({ citizenIds: a.cits.slice(0, 2), enemyKeys: ['marsh_rat'], seed: 5, actions: [], settlementId: a.sid, mods: null })).battle;
    check(!plainBattle.decks && plainBattle.deck && plainBattle.deck.hand.length === 5 && !plainBattle.deck.hand.some(c => CC.isClassCard(c)), 'a battle outside a dungeon still plays with the one home deck, and no class cards');

    // ── The class buildings and their careers ───────────────────────────
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
    const ownedW = await CC.ownedFor(wz.sid);
    check(['w_scorch', 'w_ice_ward', 'h_ember_ward'].every(x => ownedW.has(x)) && !ownedW.has('w_frost_lance') && !ownedW.has('w_fireball') && !ownedW.has('h_rekindle'), 'each building at level 1 owns its first cards: Scorch and Ice Ward, Ember Ward');
    await q("UPDATE buildings SET level=3 WHERE settlement_id=$1 AND type IN ('wizard_tower','hearth_shrine')", [wz.sid]);
    const ownedW3 = await CC.ownedFor(wz.sid);
    check(['w_frost_lance', 'w_thunderclap', 'w_fireball', 'w_deep_freeze', 'w_chain', 'h_banish', 'h_hearthlight', 'h_rekindle'].every(x => ownedW3.has(x)), 'and at level 3 owns them all, Fireball and Rekindle among them');
    v = (await D0.startTest(wz.id, 'test_green', [wizId, hkId, thirdId, fourthId])).run;
    const wizDeck = v.party.find(m => m.id === wizId).deck, hkDeck = v.party.find(m => m.id === hkId).deck;
    check(wizDeck.cls === 'wizard' && wizDeck.cards.find(c => c.key === 'w_bolt').n === 2 && wizDeck.cards.find(c => c.key === 'w_spark').n === 3 && hkDeck.cls === 'hearthkeeper' && hkDeck.cards.find(c => c.key === 'h_kindle').n === 1 && hkDeck.cards.find(c => c.key === 'h_kindle').heal,
      'in a dungeon the Wizard brings the Wizard pack and the Hearthkeeper theirs, one Kindle in it');
    const wOffer = v.pending.citizens.find(c => c.id === wizId).cards, hOffer = v.pending.citizens.find(c => c.id === hkId).cards;
    check(wOffer.length === 3 && wOffer.every(c => CC.CARDS[c.key].cls === 'wizard') && hOffer.every(c => CC.CARDS[c.key].cls === 'hearthkeeper') && !hOffer.some(c => c.key === 'h_kindle'), 'each is offered their own class\'s cards at the door (and not a second Kindle)');
    check(/^Deal \d+ damage$/.test(wizDeck.cards.find(c => c.key === 'w_spark').text) && /^Heal \d+$/.test(hkDeck.cards.find(c => c.key === 'h_kindle').text), 'with what each does in their hands');
    await quiet(wz.id, { run: v });
    r = await api(wz, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const wEng = (await api(wz, 'POST', '/api/combat/engage/' + r.body.quest_run_id)).body.battle;
    const wUnit = wEng.units.find(u => u.citizen_id === wizId), wDk = wEng.decks[wUnit.id];
    check(wDk.hand.concat(wDk.drawPile).every(c => c.startsWith('w_')) && wEng.units.find(u => u.citizen_id === hkId).role === 'hearthkeeper', "in the fight the Wizard draws only Wizard cards");
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
    await TU.setSwitch('dungeons.on', true);
    await api(g, 'POST', '/api/dungeons/run/leave');
    check((await TU.lifeAll()).filter(n => n.group === 'Dungeons').length === 13, 'thirteen dungeon numbers are tunable from Dev Tools');
    await TU.setLife('DUNGEON_HP_GREEN', 0.8);
    const g2 = await player('Tuned');
    await D.startTest(g2.id, 'test_green', g2.cits.slice(0, 4));
    r = await api(g2, 'POST', '/api/dungeons/run/move', { room: 'a' });
    b = (await q('SELECT combat_mods FROM settlement_quests WHERE id=$1', [r.body.quest_run_id])).rows[0];
    check(b.combat_mods.enemy_health === 0.8, "changing a skull's number in Dev Tools changes the next fight");
    await TU.resetLife('DUNGEON_HP_GREEN');
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
