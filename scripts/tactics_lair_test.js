// ══════════════════════════════════════════════════════════════════════════
//  tactics_lair_test — fields that differ by land, walking in several goes,
//  shots from above, and the bosses: a lair and a trick each
//  (docs/TACTICS.md §7b).
//
//  The rules and the foes only: no database, no server.
//    node scripts/tactics_lair_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const E = require('../lib/tactics_engine');
const F = require('../lib/tactics_foes');
const T = require('../lib/tactics_setup');
let passed = 0, failed = 0;
const check = (ok, name, extra) => { if (ok) { passed++; console.log('  ok   ' + name + (extra != null ? ' — ' + extra : '')); } else { failed++; console.log('  FAIL ' + name + (extra != null ? ' — ' + extra : '')); } };

const LANDS = Object.keys(E.LANDS);
const at = (m, x, y) => m.tiles[y * m.w + x];
const board = (w, h, kinds = {}, high = {}) => ({ w, h, land: 'plains', season: 'summer', tiles: Array.from({ length: w * h }, (_, i) => { const k = (i % w) + ',' + Math.floor(i / w); return { h: high[k] || 0, t: kinds[k] || 'grass' }; }) });
const ab = (key, o = {}) => ({ key, name: key, icon: '•', kind: 'attack', target: 'enemy', min: 1, max: 1, shape: 'single', dmg: 20, block: 0, heal: 0, fx: {}, cooldown: 0, quick: false, uses: null, ...o });
const unit = (id, o = {}) => ({ id, name: id, cls: 'guard', maxHp: 200, armour: 0, agility: 50, move: 3, jump: 1, abilities: [ab('hit', { attack: true })], ...o });
const foe = (id, o = {}) => unit(id, { cls: 'creature', key: 'dummy', agility: 1, move: 1, abilities: [ab('bite')], ...o });
function battle(map, party, enemies, where = {}, more = {}) {
  const st = E.createBattle({ seed: 5, land: 'plains', map, party, enemies, ...more });
  for (const u of st.units) if (where[u.id]) { u.x = where[u.id][0]; u.y = where[u.id][1]; if (where[u.id][2]) u.face = where[u.id][2]; }
  return st;
}

function lands() {
  console.log('Each land makes its own kind of field');
  const sum = {};
  let linked = true, steep = 0, startsOpen = true, sizes = new Set(), badSize = 0;
  for (const land of LANDS) {
    sum[land] = { high: 0, top: 0, trees: 0, rocks: 0, tiles: 0, n: 0 };
    for (let seed = 1; seed <= 100; seed++) {
      const z = E.sizeFor(seed, land), m = E.makeMap(seed, land, z.w, z.h, 'summer'), S = sum[land];
      sizes.add(z.w + 'x' + z.h);
      if (z.w < 7 || z.w > 10 || z.h < 7 || z.h > 10 || m.w !== z.w || m.h !== z.h || !E.SIZES[land].some(p => p[0] === z.w && p[1] === z.h)) badSize++;
      if (!E.connected(m)) linked = false;
      for (const [x, y] of E.starts(m.w, m.h).player.concat(E.starts(m.w, m.h).enemy)) if (!E.passable(E.tileAt(m, x, y))) startsOpen = false;
      for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
        const t = at(m, x, y);
        for (const [dx, dy] of [[1, 0], [0, 1]]) { const o = E.tileAt(m, x + dx, y + dy); if (o && Math.abs(o.h - t.h) > 1) steep++; }
        S.high += t.h; S.top = Math.max(S.top, t.h); S.tiles++;
        if (t.t === 'tree') S.trees += 64 / (m.w * m.h); if (t.t === 'rock') S.rocks += 64 / (m.w * m.h);
      }
      S.n++;
    }
  }
  const mean = l => sum[l].high / sum[l].tiles, trees = l => sum[l].trees / sum[l].n;
  check(linked && startsOpen && steep === 0, 'on every field the two sides can reach each other, their starting places are open, and no slope is too steep to walk');
  check(badSize === 0 && sizes.size >= 6 && E.sizeFor(12, 'forest').w === E.sizeFor(12, 'forest').w, 'fields come in different sizes, seven to ten tiles each way, each land with its own', [...sizes].sort().join(' '));
  check(mean('plains') < 0.08 && sum.plains.top <= 1, 'the plains are all but flat', `mean height ${mean('plains').toFixed(2)}`);
  check(trees('forest') >= 8 && trees('forest') > trees('plains') * 4 && trees('forest') > trees('hills') * 4, 'a forest is thick with trees', `${trees('forest').toFixed(1)} on an 8 × 8 field, to ${trees('plains').toFixed(1)} on the plains`);
  check(mean('mountain') > mean('hills') * 1.5 && mean('hills') > mean('plains') * 4 && sum.mountain.top === 4 && sum.hills.top <= 3, 'hills roll and mountains tower: peaks, ridges and shelves up to four levels',
    `mean height: plains ${mean('plains').toFixed(2)}, hills ${mean('hills').toFixed(2)}, mountain ${mean('mountain').toFixed(2)}`);
  check(sum.ruins.rocks / sum.ruins.n > sum.plains.rocks / sum.plains.n * 3 && trees('mountain') === 0, 'ruins have their walls; no tree grows on the mountain');
  const a = E.makeMap(41, 'forest', 9, 8, 'summer'), b = E.makeMap(41, 'forest', 9, 8, 'summer');
  check(JSON.stringify(a) === JSON.stringify(b) && a.ground === 'grass' && E.makeMap(41, 'mountain', 8, 10).ground === 'stone', 'the same seed, land and size make the same field, and the field says what its ground is');
}

function walking() {
  console.log('Walking in several goes');
  const m = board(8, 6, { '1,1': 'mire' });
  const st = battle(m, [unit('a', { move: 5, agility: 90 }), unit('b', { agility: 80 })], [foe('e')], { a: [0, 0], b: [7, 5], e: [4, 0, 'w'] });
  check(E.movesLeft(st) === 5 && !E.canUndo(st), 'a unit begins its turn with all its steps');
  E.move(st, 3, 0);
  const R = E.reach(st, st.units[0]);
  check(E.movesLeft(st) === 2 && Math.max(...[...R.values()].map(n => n.cost)) === 2 && !R.has('3,3') && R.has('3,2') && st.turn.moved, 'three of five walked: two are left, and that is how far it can still go');
  const hit = E.use(st, 'hit', 4, 0);
  check(hit && st.turn.acted && E.movesLeft(st) === 2 && !E.canUndo(st) && E.undoMove(st) === false, 'it strikes, and still has its two steps; the walk before the blow can no longer be taken back');
  const mv = E.move(st, 3, 2);
  check(mv && st.units[0].y === 2 && E.movesLeft(st) === 0 && E.move(st, 3, 3) === null && E.reach(st, st.units[0]).size === 1, 'it walks on after the blow, and then has no steps left');
  check(E.canUndo(st) && E.undoMove(st) === true && st.units[0].y === 0 && E.movesLeft(st) === 2 && st.turn.acted && st.turn.moved, 'the walk after the blow can be taken back; the blow stays struck');
  // Several walks before acting: each is taken back in turn.
  const s2 = battle(m, [unit('a', { move: 5, agility: 90 })], [foe('e')], { a: [0, 0], e: [7, 5] });
  E.move(s2, 2, 0); E.move(s2, 2, 1); E.move(s2, 3, 1);
  check(E.movesLeft(s2) === 1 && E.undoMove(s2) && s2.units[0].x === 2 && s2.units[0].y === 1 && E.undoMove(s2) && s2.units[0].y === 0 && E.movesLeft(s2) === 3 && E.undoMove(s2) && s2.units[0].x === 0 && E.movesLeft(s2) === 5 && !s2.turn.moved && !E.undoMove(s2),
    'three walks, taken back one by one, the last first, to where the turn began');
  // The one free step into slow ground is for a unit that has not walked yet this turn.
  const s3 = battle(m, [unit('a', { move: 2, agility: 90 })], [foe('e')], { a: [0, 1], e: [7, 5] });
  E.move(s3, 0, 0);
  E.move(s3, 1, 0);
  check(E.movesLeft(s3) === 0 && !E.reach(s3, s3.units[0]).has('1,1'), 'with one step left the mire (two steps) is out of reach: the step that is always allowed is the turn\'s first');
  const s4 = battle(m, [unit('a', { move: 2, agility: 90 })], [foe('e')], { a: [0, 1], e: [7, 5] });
  E.move(s4, 1, 0);      // two plain steps (0,1 → 0,0 → 1,0): nothing left
  const s5 = battle(m, [unit('a', { move: 3, agility: 90 })], [foe('e')], { a: [0, 1], e: [7, 5] });
  E.move(s5, 0, 0);
  check(E.movesLeft(s4) === 0 && E.movesLeft(s5) === 2 && E.reach(s5, s5.units[0]).has('1,1') === false && !!E.move(s5, 1, 0) && E.movesLeft(s5) === 1 && !E.reach(s5, s5.units[0]).has('1,1'), 'steps are counted across the walks of a turn');
  // The fingerprint tells the walks apart; a creature still walks once and then acts.
  const a1 = battle(m, [unit('a', { move: 4, agility: 90 })], [foe('e')], { a: [0, 0], e: [7, 5] }), a2 = battle(m, [unit('a', { move: 4, agility: 90 })], [foe('e')], { a: [0, 0], e: [7, 5] });
  E.move(a1, 2, 0); E.move(a2, 1, 0); E.move(a2, 2, 0);
  check(E.checksum(a1) === E.checksum(a2), 'two walks to a tile leave the board as one walk there does');
  const c = battle(board(8, 6), [unit('a', { agility: 1, move: 1 })], [foe('e', { agility: 99, move: 4 })], { a: [0, 5], e: [7, 0] });
  const ev = E.aiTurn(c);
  check(ev.filter(x => x.type === 'move').length <= 1, 'a creature walks once and then acts, as before (decided 2026-11-29: not yet for foes)');
}

function height() {
  console.log('Shots from above');
  const bow = ab('shoot', { max: 6, dmg: 40 });
  const m = board(8, 3, {}, { '0,0': 0, '1,0': 1, '2,0': 2, '3,0': 3, '4,0': 4 });
  const st = battle(m, [unit('a', { abilities: [bow, ab('hit', { dmg: 40 })] })], [foe('t', { maxHp: 900 })], { a: [0, 0], t: [1, 2, 'n'] });
  const a = st.units[0], t = E.unit(st, 't');
  const shot = (x, target = t) => { a.x = x; a.y = 0; return E.hitOf(st, a, bow, target, 1); };
  // The target faces north, towards the shooters: every shot is from the front.
  const flat = shot(0), one = shot(1), two = shot(2), three = shot(3), four = shot(4);
  check(flat.dmg === 40 && flat.above === 0 && one.dmg === 46 && one.above === 15 && two.dmg === 52 && two.above === 30 && three.dmg === 58 && three.above === 45 && four.above === 45 && four.dmg === Math.round(40 * 1.45 * (four.side === 'side' ? E.RULES.FLANK : 1)),
    'a shot does 15% more for each level it is loosed from above its target, three levels at most', `${flat.dmg}, ${one.dmg}, ${two.dmg}, ${three.dmg}, ${four.dmg}`);
  const hi = board(3, 3, {}, { '1,0': 1 });
  const s2 = battle(hi, [unit('a', { abilities: [ab('hit', { dmg: 40 })] })], [foe('t', { maxHp: 900 })], { a: [1, 0], t: [1, 1, 'n'] });
  const blow = E.hitOf(s2, s2.units[0], s2.units[0].abilities[0], E.unit(s2, 't'), 1);
  check(blow.dmg === 46 && blow.above === 15 && E.RULES.HIGH === 1.15 && E.RULES.SHOT_UP === 0.15 && E.RULES.SHOT_UP_MAX === 3, 'a blow in melee from above does 15% more, as it always has');
  a.x = 4; a.y = 0; st.order = ['a', 't']; st.index = 0;
  const f = E.forecast(st, a, bow, 1, 2)[0], ev = E.use(st, 'shoot', 1, 2).find(x => x.type === 'hit');
  check(f.above === 45 && ev.above === 45 && ev.dmg === f.dmg, 'the forecast and the hit both say by how much');
}

function lairs() {
  console.log('A lair for each boss');
  const bosses = Object.keys(F.FOES).filter(k => F.FOES[k].rank === 'boss');
  check(bosses.length === 7 && bosses.every(k => E.LAIRS[k]) && Object.keys(E.LAIRS).every(k => bosses.includes(k)) && new Set(bosses.map(k => E.LAIRS[k].name)).size === 7, 'every boss has a lair of its own, and there is no lair without a boss', bosses.map(k => E.LAIRS[k].name).join(', '));
  let ok = true, why = '';
  for (const k of bosses) for (const seed of [1, 2, 3, 4]) {
    const m = E.makeLair(seed, k), L = E.LAIRS[k], S = E.starts(m.w, m.h);
    const bad = msg => { ok = false; why = `${k}: ${msg}`; };
    if (L.rows.length !== L.high.length || L.rows.some((r, i) => r.length !== L.rows[0].length || L.high[i].length !== r.length)) bad('rows and heights do not match');
    if (m.w > 10 || m.h > 10 || m.w < 8 || m.h < 8) bad('size');
    if (!E.connected(m)) bad('the two sides cannot reach each other');
    if (!S.player.concat(S.enemy).every(([x, y]) => E.passable(E.tileAt(m, x, y)))) bad('a starting place is not open');
    if (m.season !== null || m.lair !== k || m.land !== 'lair' || m.name !== L.name || m.ground !== L.ground) bad('what the map says of itself');
    if (m.tiles.some(t => ['snow', 'ice', 'leaves', 'tree'].includes(t.t))) bad('a season indoors');
    // No slope a walker cannot take between two open tiles of the lair.
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) for (const [dx, dy] of [[1, 0], [0, 1]]) { const p = at(m, x, y), q = E.tileAt(m, x + dx, y + dy); if (q && E.passable(p) && E.passable(q) && Math.abs(p.h - q.h) > 1) bad('a cliff'); }
  }
  check(ok, 'each is a field of its own: eight to ten tiles each way, indoors (no season), walkable from end to end, open where the two sides start', why);
  const one = E.makeLair(2, 'grum'), other = E.makeLair(3, 'grum');
  check(JSON.stringify(one) !== JSON.stringify(other) && JSON.stringify(one.tiles) === JSON.stringify(Array.from({ length: other.h }, (_, y) => other.tiles.slice(y * other.w, (y + 1) * other.w).reverse()).flat())
    && JSON.stringify(E.makeLair(2, 'grum')) === JSON.stringify(one), 'the seed turns a lair left to right, and nothing else');
  check(E.makeLair(1, 'greyfeather').dark === E.RULES.DARK && bosses.filter(k => E.makeLair(1, k).dark).length === 1 && E.makeLair(1, 'nobody') === null, 'only the Owl\'s Hollow is dark');
  // A battle with a boss in it is fought in the lair; one without, on a field of the land's.
  const foes = keys => keys.map((k, i) => T.foeUnit(F.foe(k), i, 'green', null));
  const withBoss = T.fieldOf(77, 'ruins', foes(['hollow_king', 'rat_cutpurse'])), without = T.fieldOf(77, 'ruins', foes(['rat_cutpurse']));
  const st = E.replay({ seed: 77, land: 'ruins', season: 'winter', ...withBoss, party: [unit('a')], enemies: foes(['hollow_king']) }, []).state;
  check(withBoss.lair === 'hollow_king' && withBoss.w === 9 && withBoss.h === 9 && !without.lair && without.w === E.sizeFor(77, 'ruins').w && st.map.lair === 'hollow_king' && st.map.season === null && st.map.tiles.some(t => t.t === 'pillar'),
    'a fight with a boss in it is fought in the boss\'s lair, whatever the land and the season; any other on a field of the land\'s');
  const plain = E.replay({ seed: 77, land: 'ruins', ...without, party: [unit('a')], enemies: foes(['rat_cutpurse']) }, []).state;
  check(plain.map.w === without.w && plain.map.h === without.h && !plain.map.lair && E.BLOCKED.pillar && E.BLOCKED.root && E.COVER.pillar && E.COVER.root, 'a stored battle plays back on a field of its own size; a pillar and a root block the way and give cover as a rock does');
}

function tricks() {
  console.log('A trick for each boss');
  const B = k => T.foeUnit(F.foe(k), 0, 'green', null);
  const all = Object.keys(F.FOES).filter(k => F.FOES[k].rank === 'boss').map(B);
  check(all.every(u => u.trick && u.trick.name && u.trick.says && u.trick.icon) && new Set(all.map(u => u.trick.name)).size === 7 && !T.foeUnit(F.foe('rat_cutpurse'), 0, 'green', null).trick,
    'every boss has a trick, with a name and a line that says what it is; nobody else has one', all.map(u => `${u.name.split(',')[0]}: ${u.trick.name}`).join('; '));
  const red = B('redtooth'), owl = B('greyfeather'), sm = B('storm_matriarch'), grum = B('grum'), snap = B('old_snapjaw'), bog = B('bog_mother'), king = B('hollow_king');
  check(red.riposte === 0.5 && owl.sees === true && sm.aloft === 0.5 && snap.shell === 0.5 && king.rises === 0.5 && grum.abilities.find(a => a.key === 'boulder').fx.rubble === 1 && bog.abilities.find(a => a.key === 'tongue').fx.pull === 1
    && !red.aloft && !snap.rises && !grum.abilities.find(a => a.key === 'greatclub').fx.rubble, 'each trick switches on its own rule, and only that');

  // Riposte.
  let st = battle(board(6, 6), [unit('a', { agility: 90 }), unit('b', { agility: 80, abilities: [ab('shoot', { max: 4, dmg: 20, attack: true })] }), unit('c', { agility: 70 })], [{ ...red, agility: 1 }], { a: [2, 3], b: [2, 5], c: [1, 2], [red.id]: [2, 2, 's'] });
  const R = E.unit(st, red.id);
  let ev = E.use(st, 'hit', 2, 2);
  const back = ev.find(x => x.type === 'hit' && x.counter);
  check(ev.some(x => x.type === 'counter' && x.id === red.id) && back && back.id === 'a' && E.unit(st, 'a').hp === 200 - back.dmg && back.dmg > 0, 'Redtooth: struck by someone beside him, he strikes back at half strength', `${back && back.dmg}`);
  E.endTurn(st);
  ev = E.use(st, 'shoot', 2, 2);
  check(!ev.some(x => x.type === 'counter'), 'a shot from further off is not answered');
  E.endTurn(st);
  ev = E.use(st, 'hit', 2, 2);
  check(ev.some(x => x.type === 'counter') && !R.countered, 'and he answers every blow, not one a round');
  const weak = battle(board(6, 6), [unit('a', { agility: 90, maxHp: 3 })], [{ ...red, agility: 1 }], { a: [2, 3], [red.id]: [2, 2, 's'] });
  E.use(weak, 'hit', 2, 2);
  check(E.unit(weak, 'a').hp === 1 && !E.unit(weak, 'a').down, 'his answer never fells: the striker is left with 1 at the least');

  // Aloft.
  const bow = ab('shoot', { max: 5, dmg: 40, attack: true });
  const hill = board(6, 4, {}, { '2,0': 2, '2,1': 1, '3,0': 2, '4,0': 2 });
  st = battle(hill, [unit('a', { abilities: [bow, ab('hit', { dmg: 40 })] })], [{ ...sm, agility: 1 }], { a: [2, 3], [sm.id]: [2, 0, 's'] });
  const SM = E.unit(st, sm.id), A = st.units[0];
  const below = E.hitOf(st, A, bow, SM, 1); A.x = 4; A.y = 0;
  const level = E.hitOf(st, A, bow, SM, 1); A.x = 2; A.y = 1;
  const melee = E.hitOf(st, A, A.abilities[1], SM, 1);
  check(below.aloft && below.dmg === 20 && !level.aloft && level.dmg === Math.round(40 * E.RULES.FLANK) && !melee.aloft, 'the Storm Matriarch: a shot from below her does half; from her own height, or a blow in melee, the whole', `${below.dmg} to ${level.dmg}`);

  // Shell.
  st = battle(board(6, 6), [unit('a', { abilities: [ab('hit', { dmg: 40 })] })], [{ ...snap, agility: 1, armour: 0 }], { a: [2, 3], [snap.id]: [2, 2, 's'] });
  const SN = E.unit(st, snap.id), a2 = st.units[0];
  const front = E.hitOf(st, a2, a2.abilities[0], SN, 1); a2.x = 3; a2.y = 2;
  const side = E.hitOf(st, a2, a2.abilities[0], SN, 1); a2.x = 2; a2.y = 1;
  const rear = E.hitOf(st, a2, a2.abilities[0], SN, 1);
  check(front.shell && front.dmg === 20 && !side.shell && side.dmg === 50 && !rear.shell && rear.dmg === 60, 'Old Snapjaw: a blow to his front does half; from the side and from behind he is as soft as anyone', `${front.dmg}, ${side.dmg}, ${rear.dmg}`);

  // Rises.
  st = battle(board(6, 6), [unit('a', { agility: 90, abilities: [ab('hit', { dmg: 500, fx: { weak: 2 } })] }), unit('b', { agility: 80, abilities: [ab('hit', { dmg: 500 })] })], [{ ...king, agility: 1, armour: 0 }, foe('m', { agility: 2 })], { a: [2, 3], b: [3, 2], [king.id]: [2, 2, 's'], m: [5, 5] });
  const K = E.unit(st, king.id), fore = E.forecast(st, st.units[0], st.units[0].abilities[0], 2, 2)[0];
  ev = E.use(st, 'hit', 2, 2);
  check(fore.rises === true && fore.kill === false && ev.some(x => x.type === 'rise' && x.id === king.id && x.hp === Math.round(K.maxHp * 0.5)) && !ev.some(x => x.type === 'down') && !K.down && K.hp === Math.round(K.maxHp * 0.5) && K.risen === true && st.status === 'active',
    'the Hollow King: the first time he falls he rises again with half his health, and the forecast says so');
  E.endTurn(st);
  const fore2 = E.forecast(st, E.unit(st, 'b'), E.unit(st, 'b').abilities[0], 2, 2)[0];
  ev = E.use(st, 'hit', 2, 2);
  check(fore2.kill === true && !fore2.rises && ev.some(x => x.type === 'down' && x.id === king.id) && K.down && !ev.some(x => x.type === 'rise'), 'the second time he stays down');
  const pois = battle(board(6, 6), [unit('a', { agility: 90 })], [{ ...king, agility: 80 }], { a: [0, 5], [king.id]: [5, 0] });
  const K2 = E.unit(pois, king.id); K2.hp = 2; K2.st.poison = 5;
  E.endTurn(pois);
  check(K2.risen === true && !K2.down && K2.hp > 2 && !(K2.st.poison > 0), 'poison that would fell him wakes him the same way, and is gone');

  // Rubble.
  st = battle(board(7, 7), [unit('a', { agility: 1, maxHp: 900 }), unit('b', { agility: 1, maxHp: 900 })], [{ ...grum, agility: 99, move: 1 }], { a: [3, 5], b: [3, 6], [grum.id]: [3, 2, 's'] });
  const before = st.map.tiles.filter(t => t.t === 'rock').length, sum0 = E.checksum(st);
  ev = E.use(st, 'boulder', 3, 5);
  const rub = ev && ev.find(x => x.type === 'rubble');
  check(rub && E.tileAt(st.map, rub.x, rub.y).t === 'rock' && E.dist(rub.x, rub.y, 3, 5) === 1 && !E.unitAt(st, rub.x, rub.y) && st.map.tiles.filter(t => t.t === 'rock').length === before + 1 && E.checksum(st) !== sum0,
    'Grum: a boulder thrown at someone comes to rest on an open tile beside them, as a rock', rub && `${rub.x},${rub.y}`);
  // It never walls anyone in, and there is an end to it.
  const pen = board(5, 5, { '0,1': 'rock', '1,0': 'rock' });
  st = battle(pen, [unit('a', { agility: 1, maxHp: 900 })], [{ ...grum, agility: 99, move: 1 }], { a: [0, 0], [grum.id]: [3, 0, 'w'] });
  // (0,0) has one way out, by (1,1)? No: its neighbours are (1,0) and (0,1), both rock: it is walled in already. Use a corner with one way out.
  const pen2 = board(5, 5, { '0,1': 'rock' });
  st = battle(pen2, [unit('a', { agility: 1, maxHp: 900 })], [{ ...grum, agility: 99, move: 1 }], { a: [0, 0], [grum.id]: [3, 0, 'w'] });
  ev = E.use(st, 'boulder', 0, 0);
  check(ev && !ev.some(x => x.type === 'rubble') && E.tileAt(st.map, 1, 0).t === 'grass', 'a boulder that would wall someone in rolls away: nobody is ever cut off');
  // He throws at whoever is in reach, wherever they stand, over and over (the test readies the boulder again each time).
  const many = battle(board(9, 9), [unit('a', { agility: 1, maxHp: 9000 })], [{ ...grum, agility: 99, move: 1 }], { a: [4, 6], [grum.id]: [4, 3, 's'] });
  let thrown = 0;
  for (const spot of [[4, 6], [2, 4], [6, 4], [1, 2], [7, 2], [4, 7], [3, 5], [5, 5], [2, 6], [6, 6]]) {
    const A9 = E.unit(many, 'a'), G = E.unit(many, grum.id);
    A9.x = spot[0]; A9.y = spot[1]; G.x = spot[0]; G.y = spot[1] - 3 >= 0 ? spot[1] - 3 : spot[1] + 3; G.cd = {}; many.turn.acted = false;
    if (E.tileAt(many.map, G.x, G.y).t === 'rock') continue;
    if (E.use(many, 'boulder', A9.x, A9.y)) thrown++;
  }
  check(thrown >= 8 && many.rubble === E.RULES.RUBBLE && many.map.tiles.filter(t => t.t === 'rock').length === E.RULES.RUBBLE, `no more than ${E.RULES.RUBBLE} of his boulders stay in a battle`, `${thrown} thrown`);

  // Pull.
  const sink = board(7, 7, { '3,3': 'mire', '3,2': 'mire' });
  st = battle(sink, [unit('a', { agility: 1, maxHp: 900 }), unit('b', { agility: 1, maxHp: 900 })], [{ ...bog, agility: 99, move: 1 }], { a: [3, 4], b: [0, 6], [bog.id]: [3, 1, 's'] });
  ev = E.use(st, 'tongue', 3, 4);
  const pull = ev && ev.find(x => x.type === 'push' && x.pull);
  check(pull && pull.id === 'a' && E.unit(st, 'a').x === 3 && E.unit(st, 'a').y === 2 && E.tileAt(st.map, 3, 2).t === 'mire', 'the Bog Mother: her tongue drags whoever it lashes to her feet, mire or no', pull && `${pull.from.x},${pull.from.y} → ${pull.to.x},${pull.to.y}`);
  st = battle(board(7, 7, { '3,2': 'rock' }), [unit('a', { agility: 1, maxHp: 900 }), unit('b', { agility: 1, maxHp: 900 })], [{ ...bog, agility: 99, move: 1 }], { a: [3, 4], b: [3, 3], [bog.id]: [2, 2, 's'] });
  ev = E.use(st, 'tongue', 3, 4);
  check(ev && E.unit(st, 'a').x === 2 && E.unit(st, 'a').y === 3 && E.dist(2, 3, 2, 2) === 1, 'a friend or a rock in the way: they are dragged round it if there is a way, and stop where there is none', `${E.unit(st, 'a').x},${E.unit(st, 'a').y}`);

  // The dark.
  const far = ab('shoot', { min: 2, max: 5, dmg: 20, attack: true });
  const mk = (light, sees) => {
    const s = battle(board(8, 8), [unit('a', { abilities: [far], agility: 90 }), unit('h', { agility: 80, ...(light ? { light: true } : {}) })], [{ ...owl, agility: 1, ...(sees ? {} : { sees: false }) }], { a: [3, 7], h: [0, 0], [owl.id]: [3, 2, 's'] });
    s.dark = E.RULES.DARK;
    return s;
  };
  st = mk(false, true);
  const arch = st.units[0], O = E.unit(st, owl.id), bolt = O.abilities.find(a => a.key === 'moonbolt');
  check(E.touched(st, arch, far, 3, 2).length === 0 && E.reachOf(st, arch, far, arch, 3, 2) === 3 && !E.lit(st, arch, arch), 'the Owl\'s Hollow: in the dark an archer five tiles off cannot aim that far (three tiles, no more)');
  check(E.touched(st, O, bolt, 3, 7).length === 1 && E.reachOf(st, O, bolt, O, 3, 7) === 5, 'Old Greyfeather sees well enough: his bolt reaches as far as ever');
  arch.y = 5;
  check(E.touched(st, arch, far, 3, 2).length === 1, 'three tiles off, the archer can shoot');
  arch.y = 7;
  const lit = mk(true, true), a3 = lit.units[0], h = E.unit(lit, 'h');
  check(E.touched(lit, a3, far, 3, 2).length === 0, 'a lantern across the field is no help');
  h.x = 4; h.y = 7;
  check(E.lit(lit, a3, a3) && E.touched(lit, a3, far, 3, 2).length === 1 && E.lit(lit, h, h), 'standing beside whoever carries a lantern, the archer can see to aim; so can the one who carries it');
  h.down = true;
  check(!E.lit(lit, a3, a3), 'a lantern that has fallen lights nobody');
  const day = battle(board(8, 8), [unit('a', { abilities: [far] })], [{ ...owl, agility: 1 }], { a: [3, 7], [owl.id]: [3, 2, 's'] });
  check(!day.dark && E.touched(day, day.units[0], far, 3, 2).length === 1, 'anywhere else there is light enough');
  const real = E.replay({ seed: 4, land: 'forest', lair: 'greyfeather', party: [unit('a')], enemies: [owl] }, []).state;
  check(real.dark === E.RULES.DARK && real.map.dark === E.RULES.DARK, 'a battle in the Hollow is dark from its first turn');
  // A lantern makes its bearer a light.
  const GEAR = require('../lib/gear_kinds');
  check(GEAR.kindOf({ key: 'ember_lantern', name: 'Ember Lantern' }) === 'lantern', 'an ember lantern is a lantern (and so a light: lib/tactics_setup.js partyUnit)');
}

function whole() {
  console.log('Whole boss fights in their lairs');
  const party = () => [unit('a', { abilities: [ab('hit', { dmg: 18, attack: true })], maxHp: 140 }), unit('b', { cls: 'archer', abilities: [ab('shoot', { min: 2, max: 5, dmg: 14, attack: true })], agility: 60, maxHp: 110 }),
    unit('c', { abilities: [ab('hit', { dmg: 18, attack: true })], agility: 40, maxHp: 140 }), unit('d', { cls: 'hearthkeeper', light: true, agility: 30, maxHp: 90, abilities: [ab('knock', { dmg: 10, attack: true }), ab('mend', { kind: 'heal', target: 'ally', dmg: 0, heal: 30, min: 1, max: 3 })] })];
  let stuck = 0, n = 0, seen = { rise: 0, rubble: 0, pull: 0, counter: 0, aloft: 0, shell: 0 }, won = 0;
  for (const k of Object.keys(E.LAIRS)) for (let seed = 1; seed <= 6; seed++) {
    const enemies = [T.foeUnit(F.foe(k), 0, 'green', null), T.foeUnit(F.foe('rat_cutpurse'), 1, 'green', null)];
    const st = E.createBattle({ seed: seed * 17 + 3, land: 'forest', lair: k, party: party(), enemies });
    for (let g = 0; g < 900 && st.status === 'active'; g++) {
      for (const ev of E.aiTurn(st)) { if (seen[ev.type] != null) seen[ev.type]++; if (ev.type === 'push' && ev.pull) seen.pull++; if (ev.type === 'hit' && ev.aloft) seen.aloft++; if (ev.type === 'hit' && ev.shell) seen.shell++; }
    }
    n++; if (!E.over(st)) stuck++; if (st.status === 'victory') won++;
  }
  check(stuck === 0, `${n} boss fights, each boss in its lair, all fought to an end`, `${won} won; ` + Object.keys(seen).map(k => `${k} ${seen[k]}`).join(', '));
  // (The mind gets round Old Snapjaw whenever it can, so his shell may never be struck: that is the trick working.)
  check(seen.rise >= 1 && seen.rubble >= 1 && seen.pull >= 1 && seen.counter >= 1, 'the tricks come up in ordinary play: he rises, boulders stay, the tongue drags, the riposte answers');
}

lands(); walking(); height(); lairs(); tricks(); whole();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
