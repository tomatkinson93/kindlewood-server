// ══════════════════════════════════════════════════════════════════════════
//  tactics_ground_test — the board itself (docs/TACTICS.md §7a):
//  ground that slows, cover from shots, the season the map is made for,
//  hiding in fallen leaves, and placing the party before the first turn.
//
//  The rules only (lib/tactics_engine.js): no database, no server.
//    node scripts/tactics_ground_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const E = require('../lib/tactics_engine');
let passed = 0, failed = 0;
const check = (ok, name, extra) => { if (ok) { passed++; console.log('  ok   ' + name + (extra != null ? ' — ' + extra : '')); } else { failed++; console.log('  FAIL ' + name + (extra != null ? ' — ' + extra : '')); } };

const LANDS = Object.keys(E.LANDS);
const count = (m, kind) => m.tiles.filter(t => t.t === kind).length;
const at = (m, x, y) => m.tiles[y * m.w + x];
// A flat board with some tiles of other kinds: { 'x,y': kind }.
const board = (w, h, kinds = {}) => ({ w, h, land: 'plains', season: 'summer', tiles: Array.from({ length: w * h }, (_, i) => ({ h: 0, t: kinds[(i % w) + ',' + Math.floor(i / w)] || 'grass' })) });
const ab = (key, o = {}) => ({ key, name: key, icon: '•', kind: 'attack', target: 'enemy', min: 1, max: 1, shape: 'single', dmg: 20, block: 0, heal: 0, fx: {}, cooldown: 0, quick: false, uses: null, ...o });
const unit = (id, o = {}) => ({ id, name: id, cls: 'guard', maxHp: 200, armour: 0, agility: 50, move: 3, jump: 1, abilities: [ab('hit')], ...o });
const foe = (id, o = {}) => unit(id, { cls: 'creature', key: 'dummy', agility: 1, move: 0, abilities: [ab('bite')], ...o });
// A battle on a made board, with everyone put where the test wants them: { id: [x, y, face] }.
function battle(map, party, enemies, where = {}) {
  const st = E.createBattle({ seed: 5, land: 'plains', map, party, enemies });
  for (const u of st.units) if (where[u.id]) { u.x = where[u.id][0]; u.y = where[u.id][1]; if (where[u.id][2]) u.face = where[u.id][2]; }
  return st;
}

function maps() {
  console.log('The map is made for a season');
  let same = true, zoneOpen = true, linked = true, tagged = true;
  const sum = {};
  for (const season of E.SEASONS) {
    sum[season] = { fords: [], water: 0, ice: 0, mire: 0, snow: [], leaves: [], lone: 0, shallows: 0 };
    for (const land of LANDS) for (let seed = 1; seed <= 120; seed++) {
      const m = E.makeMap(seed, land, 8, 8, season), S = sum[season];
      if (JSON.stringify(m) !== JSON.stringify(E.makeMap(seed, land, 8, 8, season))) same = false;
      if (!E.connected(m)) linked = false;
      if (m.season !== season || m.land !== land) tagged = false;
      // The two rows each side starts on are always open, ordinary ground.
      for (const y of [0, 1, 6, 7]) for (let x = 0; x < 8; x++) if (at(m, x, y).t !== E.LANDS[land].ground) zoneOpen = false;
      if (land === 'river') S.fords.push(count(m, season === 'winter' ? 'ice' : 'shallows'));
      S.water += count(m, 'water'); S.ice += count(m, 'ice'); S.mire += count(m, 'mire'); S.shallows += count(m, 'shallows');
      S.snow.push(count(m, 'snow')); S.leaves.push(count(m, 'leaves'));
      // Every leaf lies beside a tree.
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (at(m, x, y).t === 'leaves' && !E.DIR_KEYS.some(d => (E.tileAt(m, x + E.DIRS[d][0], y + E.DIRS[d][1]) || {}).t === 'tree')) S.lone++;
    }
  }
  const all = (list, f) => list.every(f), max = list => Math.max(...list);
  check(same && tagged, 'the same seed, land and season always make the same map, and the map says which season it is');
  check(linked && zoneOpen, 'in every season the two sides can reach each other, and the rows they start on are open ground');
  check(E.makeMap(9, 'river', 8, 8).season === 'summer' && JSON.stringify(E.makeMap(9, 'river', 8, 8, 'monsoon')) === JSON.stringify(E.makeMap(9, 'river', 8, 8, 'summer')), 'a map made for no season (or one the game does not have) is a summer map');
  check(all(sum.summer.fords, n => n === 2 || n === 0) && sum.summer.fords.some(n => n === 2) && all(sum.autumn.fords, n => n === 2 || n === 0), 'summer and autumn: a stream has two fords, and a ford is shallows');
  check(all(sum.spring.fords.filter(n => n < 3), n => n <= 1) && sum.spring.fords.some(n => n === 1) && sum.spring.mire > sum.summer.mire * 2 && sum.spring.shallows > sum.summer.shallows,
    'spring: the stream runs high and keeps one ford; there is mud after the thaw (meltwater on bare stone)', `mire ${sum.summer.mire} → ${sum.spring.mire}`);
  check(sum.winter.water === 0 && sum.winter.mire === 0 && sum.winter.shallows === 0 && sum.winter.ice > 0 && all(sum.winter.snow, n => n === 5) && max(sum.summer.snow) === 0 && sum.summer.ice === 0,
    'winter: all water is ice, the mire is frozen hard, and five drifts of snow lie on every map; no other season has ice or snow');
  check(max(sum.autumn.leaves) <= 6 && sum.autumn.leaves.some(n => n > 0) && sum.autumn.lone === 0 && max(sum.summer.leaves) === 0 && max(sum.winter.leaves) === 0, 'autumn: up to six tiles of fallen leaves, each beside a tree; no other season has them');
  check(sum.summer.mire > 0 && count(E.makeMap(3, 'plains', 8, 8, 'summer'), 'mire') === 0 && E.LANDS.marsh.mire > E.LANDS.river.mire, 'in summer only wet lands have mire: the marsh most, a little by the river');
}

function ground() {
  console.log('Ground that slows');
  // A lane across the top: grass, mire, grass, grass; open grass below it.
  const m = board(6, 4, { '1,0': 'mire', '3,1': 'snow', '4,2': 'shallows', '5,3': 'ice', '0,3': 'leaves' });
  const st = battle(m, [unit('a', { move: 3 })], [foe('e')], { a: [0, 0], e: [5, 0] });
  const R = E.reach(st, st.units[0]), c = (x, y) => (R.get(x + ',' + y) || {}).cost;
  check(E.stepCost(at(m, 1, 0)) === 2 && E.stepCost(at(m, 3, 1)) === 2 && E.stepCost(at(m, 4, 2)) === 2 && E.stepCost(at(m, 5, 3)) === 1 && E.stepCost(at(m, 0, 3)) === 1 && E.stepCost(at(m, 0, 0)) === 1,
    'mire, snow and shallows take two steps to walk into; ice and fallen leaves walk as open ground');
  check(c(1, 0) === 2 && c(2, 0) === 3 && c(0, 1) === 1 && c(1, 1) === 2 && c(2, 1) === 3 && c(3, 0) === undefined, 'a walk counts them: through the mire a unit with three steps gets two tiles; around it, three');
  const path = E.pathTo(R, 2, 0).map(p => p.x + ',' + p.y).join(' ');
  check(path === '0,0 1,0 2,0' || path === '0,0 0,1 1,1 2,1 2,0', 'the path shown is one the steps allow', path);
  const slow = battle(m, [unit('a', { move: 1 })], [foe('e')], { a: [0, 0], e: [5, 0] });
  const R1 = E.reach(slow, slow.units[0]);
  check(R1.has('1,0') && R1.get('1,0').cost === 1 && R1.has('0,1') && R1.size === 3, 'a unit can always take one step, even into the mire with a single step to its name');
  const two = battle(m, [unit('a', { move: 2 })], [foe('e')], { a: [2, 1], e: [5, 0] });
  const R2 = E.reach(two, two.units[0]);
  check(R2.has('3,1') && !R2.has('4,1') && R2.has('2,3') && !(R2.get('3,1') || {}).cost !== 2, 'and two steps are spent on one tile of snow', (R2.get('3,1') || {}).cost);
  const mv = E.move(st, 2, 0);
  check(mv && st.units[0].x === 2 && E.move(st, 3, 0) === null, 'moving there works as any move does (once a turn)');
  // The mind walks around slow ground when that is quicker: a wall of mire with a gap.
  const wall = board(7, 5, { '3,0': 'mire', '3,1': 'mire', '3,2': 'mire', '3,3': 'mire' });
  const w = battle(wall, [unit('a')], [foe('e', { move: 3, agility: 99 })], { a: [0, 0], e: [6, 0, 'w'] });
  E.aiTurn(w);
  const e = E.unit(w, 'e');
  check(e.x < 6 || e.y > 0, 'a creature still finds its way across a board with slow ground on it', `${e.x},${e.y}`);
}

function cover() {
  console.log('Cover from shots');
  const bow = ab('shoot', { max: 4, dmg: 40 });
  // The target at (3,3). A tree north of it. Shooters stand north, south, and next to it.
  const m = board(7, 7, { '3,2': 'tree', '0,3': 'rock' });
  const st = battle(m, [unit('n', { abilities: [bow, ab('hit', { dmg: 40 })] }), unit('s', { abilities: [bow] }), unit('w', { abilities: [bow] }), unit('d', { abilities: [bow] })], [foe('t', { maxHp: 900 }), foe('r', { maxHp: 900 })],
    { n: [3, 0], s: [3, 6], w: [2, 3], d: [5, 1], t: [3, 3, 's'], r: [1, 3, 's'] });
  const t = E.unit(st, 't'), hit = (id, a, target = t) => E.hitOf(st, E.unit(st, id), a, target, 1);
  // Facing south: the shot from the north is from behind (×1.5), from the south the front.
  const open = hit('s', bow), behind = hit('n', bow);
  check(open.cover === false && open.dmg === 40 && behind.cover === true && behind.dmg === Math.round(40 * E.RULES.BACK * E.RULES.COVER), 'a shot from the side the tree is on does a quarter less; from the other side the tree is no help', `${behind.dmg} of ${Math.round(40 * E.RULES.BACK)}`);
  check(hit('d', bow).cover === true && hit('w', bow).cover === false, 'a shot from a diagonal counts the tree if it is on either near side; one loosed from the next tile does not (there is nothing between them)');
  const sword = E.hitOf(st, E.unit(st, 'w'), ab('hit', { dmg: 40 }), t, 1);
  check(sword.cover === false, 'a blow in melee is never stopped by cover');
  check(E.coverFrom(st, 3, 0, E.unit(st, 'r')) === false && E.coverFrom(st, 0, 6, E.unit(st, 'r')) === true && E.COVER.rock && E.COVER.tree && !E.COVER.water, 'a rock is cover just as a tree is; water is not');
  // Forecast and the event both say so.
  st.order = ['n', 's', 'w', 'd', 't', 'r']; st.index = 0;
  const f = E.forecast(st, E.unit(st, 'n'), bow, 3, 3)[0];
  const ev = E.use(st, 'shoot', 3, 3).find(x => x.type === 'hit');
  check(f.cover === true && f.dmg === behind.dmg && ev.cover === true && ev.dmg === behind.dmg && t.hp === 900 - behind.dmg, 'what is forecast is what happens, and both say the shot was at someone in cover');
  // The mind likes cover when someone is shooting at it.
  const m2 = board(7, 5, { '3,3': 'rock' });
  const w = battle(m2, [unit('a', { abilities: [bow], move: 0 })], [foe('e', { move: 2, agility: 99, abilities: [ab('bite')] })], { a: [3, 0, 's'], e: [2, 4, 'n'] });
  const p = E.plan(w);
  check(p && p.to, 'a creature weighs cover when it chooses where to stand', p && `${p.to.x},${p.to.y}`);
}

function hidden() {
  console.log('Hidden in fallen leaves');
  const bow = ab('shoot', { max: 5, dmg: 30 }), blast = ab('blast', { max: 5, dmg: 30, shape: 'burst', radius: 1 }), bolt = ab('bolt', { max: 5, dmg: 30, shape: 'line' });
  const m = board(7, 7, { '3,3': 'leaves', '4,3': 'leaves' });
  const mk = () => battle(m, [unit('a', { abilities: [ab('hit'), bow, ab('ward', { kind: 'skill', target: 'self', dmg: 0, block: 10, min: 0, max: 0 })], agility: 90 }), unit('b', { agility: 80, abilities: [ab('hit', { fx: { push: 1 } })] })],
    [foe('far', { abilities: [bow, blast, bolt], agility: 5 }), foe('near', { agility: 4 })], { a: [3, 3, 'n'], b: [0, 6], far: [3, 0, 's'], near: [6, 6] });
  let st = mk();
  const a = () => E.unit(st, 'a'), far = () => E.unit(st, 'far');
  const end = () => E.endTurn(st);
  // a ends the turn where they stand, on leaves, without moving or striking.
  let ev = end();
  check(a().hidden === true && ev.some(x => x.type === 'hide' && x.id === 'a'), 'a unit that ends its turn on fallen leaves, having neither moved nor struck, is hidden');
  check(E.touched(st, far(), bow, 3, 3).length === 0 && !E.targetTiles(st, far(), bow).some(t => t.x === 3 && t.y === 3), 'a foe further off than one tile cannot single them out');
  check(E.touched(st, far(), blast, 3, 2).some(h => h.u.id === 'a') && E.touched(st, far(), bolt, 3, 3).some(h => h.u.id === 'a'), 'a burst or a line still catches them');
  const near = E.unit(st, 'near'); near.x = 3; near.y = 4;
  check(E.touched(st, near, near.abilities[0], 3, 3).length === 1, 'a foe standing next to them can strike as ever');
  near.x = 6; near.y = 6;
  // b ends, the foes take their turns (far cannot shoot a; it may blast), round two: a's turn again.
  end(); E.settle(st);
  check(E.current(st).id === 'a' && a().hidden === true, 'they stay hidden into their next turn');
  // Moving shows them; taking the move back hides them again.
  const before = E.checksum(st), free = E.unitAt(st, 4, 3) ? [3, 4] : [4, 3];
  E.move(st, free[0], free[1]);
  check(a().hidden === false && E.checksum(st) !== before, 'moving shows them (even on to more leaves)');
  E.undoMove(st);
  check(a().hidden === true && E.checksum(st) === before, 'taking the move back, they are hidden as before');
  // Blocking is not striking.
  E.use(st, 'ward', 3, 3);
  check(a().hidden === true, 'using an ability that strikes nobody does not show them');
  // Striking shows them, and a turn with a blow in it does not end hidden. (The foe may have walked since: it cannot single them out from afar.)
  st = mk(); end(); end(); E.settle(st);
  ev = E.use(st, 'shoot', far().x, far().y) || E.use(st, 'hit', far().x, far().y);
  check(ev && ev.some(x => x.type === 'show' && x.id === 'a') && a().hidden === false, 'striking shows them');
  ev = end();
  check(a().hidden === false && !ev.some(x => x.type === 'hide'), 'and a turn in which they struck does not end with them hidden');
  // A shove shows them.
  st = mk(); end();
  const b = E.unit(st, 'b'); b.x = 3; b.y = 4; a().side = 'enemy';      // (b strikes a, to test the shove: a stands in for a foe)
  E.use(st, 'hit', 3, 3);
  check(a().hidden === false && a().y === 2, 'being shoved off the spot shows them');
  // Only leaves hide.
  st = battle(m, [unit('a', { agility: 90 })], [foe('far', { abilities: [bow] })], { a: [2, 3], far: [2, 0] });
  E.endTurn(st);
  check(!E.unit(st, 'a').hidden, 'standing still anywhere else hides nobody');
}

function placing() {
  console.log('Placing the party');
  const party = [unit('a'), unit('b'), unit('c'), unit('d', { down: true })], foes = [foe('e', { agility: 99, move: 3 }), foe('f')];
  const st = E.createBattle({ seed: 7, land: 'forest', season: 'autumn', place: true, party, enemies: foes });
  const zone = E.zone(st), H = st.map.h, W = st.map.w;
  check(st.status === 'placing' && E.current(st) === null && st.order.length === 0 && !E.over(st), 'a battle that begins with placing waits: it is nobody\'s turn, though a foe is the quickest there');
  check(zone.length === W * 2 && zone.every(z => z.y >= H - 2 && E.passable(E.tileAt(st.map, z.x, z.y))), 'the party may stand on any open tile of its own two rows');
  check(E.apply(st, { t: 'end' }) === null && E.apply(st, { t: 'move', x: 0, y: 0 }) === null && E.settle(st).length === 0, 'nothing else happens first: no turn is taken and the foes wait');
  const copy = () => JSON.parse(JSON.stringify(st));
  const bad = at => E.place(copy(), at) === null;
  const A = st.units[0], B = st.units[1];
  check(bad({ a: [0, H - 3] }) && bad({ a: [0, 0] }) && bad({ a: [W, H - 1] }) && bad({ a: [B.x, B.y] }) && bad({ a: [0, H - 1], b: [0, H - 1] }) && bad({ e: [0, H - 1] }) && bad({ zz: [0, H - 1] }) && bad({ a: 'x' }) && bad({ a: [0.5, H - 1] }),
    'refused: a tile outside those rows or off the board, one a friend keeps, two on one tile, a foe, a stranger, and what is no place at all');
  const keep = copy(), evKeep = E.place(keep, {});
  check(evKeep && keep.status === 'active' && keep.units.filter(u => u.side === 'player').every((u, i) => u.x === st.units[i].x && u.y === st.units[i].y), 'placing nobody keeps the places that were suggested');
  const s2 = copy(), ev = E.apply(s2, { t: 'place', at: { a: [B.x, B.y], b: [A.x, A.y], c: [0, H - 1], d: [W - 1, H - 1] } });
  const u = id => E.unit(s2, id);
  check(ev && ev[0].type === 'place' && u('a').x === B.x && u('b').x === A.x && u('c').x === 0 && u('c').y === H - 1 && u('d').x === W - 1 && u('d').down, 'two may swap, and anyone may be moved, a fallen citizen too');
  check(s2.status === 'active' && E.current(s2).side === 'player' && ev.some(x => x.type === 'turn' && x.id === 'e') && s2.stats.enemyTurns >= 1, 'then the battle begins as any does: the quickest goes first, and a foe quicker than the party has already taken its turn');
  check(E.place(s2, {}) === null && E.apply(s2, { t: 'place', at: {} }) === null, 'the party is placed once');
  // A stored battle plays back the same.
  const setup = { seed: 7, land: 'forest', season: 'autumn', place: true, party, enemies: foes };
  const acts = [{ t: 'place', at: { c: [0, H - 1] } }, { t: 'end' }];
  const r1 = E.replay(setup, acts), r2 = E.replay(setup, acts), r0 = E.replay(setup, []);
  check(r1.bad === -1 && E.checksum(r1.state) === E.checksum(r2.state) && r0.state.status === 'placing' && E.replay(setup, [{ t: 'end' }]).bad === 0 && r1.state.map.season === 'autumn', 'a stored battle plays back the same from its placing on; one whose first choice is not the placing does not replay');
  // A battle with no placing is as it always was; the mind places nobody.
  const plain = E.createBattle({ seed: 7, land: 'forest', party, enemies: foes });
  check(plain.status === 'active' && E.current(plain), 'a battle that is not asked to begin with placing begins at once');
  const auto = E.autoplay({ seed: 7, land: 'forest', place: true, party: [unit('a'), unit('b')], enemies: [foe('e', { move: 3, maxHp: 30 })] }, 400);
  check(E.over(auto), 'left to the mind, a battle with placing is played out from the suggested places', auto.status);
}

function seasonsPlay() {
  console.log('Whole battles in every season');
  const party = () => [unit('a', { abilities: [ab('hit', { dmg: 30 })] }), unit('b', { cls: 'archer', abilities: [ab('shoot', { max: 4, dmg: 22 })], agility: 60 }), unit('c', { abilities: [ab('hit', { dmg: 30 })], agility: 40 })];
  const foes = () => [foe('e', { move: 3, maxHp: 90, agility: 45 }), foe('f', { move: 3, maxHp: 90, agility: 30, abilities: [ab('spit', { max: 3, dmg: 14 })] }), foe('g', { move: 4, maxHp: 60, agility: 70 })];
  let stuck = 0, n = 0, hid = 0, covered = 0;
  for (const season of E.SEASONS) for (const land of LANDS) for (let seed = 1; seed <= 6; seed++) {
    const st = E.createBattle({ seed: seed * 31 + 5, land, season, party: party(), enemies: foes() });
    for (let g = 0; g < 600 && st.status === 'active'; g++) {
      for (const ev of E.aiTurn(st)) { if (ev.type === 'hide') hid++; if (ev.type === 'hit' && ev.cover) covered++; }
    }
    n++; if (!E.over(st)) stuck++;
  }
  check(stuck === 0, `${n} battles, every land in every season, all fought to an end`, `${covered} shots at someone in cover, ${hid} times someone hid`);
  check(covered > 0, 'cover comes up in ordinary play');
}

maps(); ground(); cover(); hidden(); placing(); seasonsPlay();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
