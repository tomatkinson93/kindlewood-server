// The tactics battle prototype's server side (lib/tactics_setup.js, routes/tactics.js).
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/tactics_test.js
'use strict';
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const T = require('../lib/tactics_setup');
const CC = require('../lib/class_cards');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

console.log('Reading a card into numbers');
{
  const stats = { strength: 11, agility: 8, endurance: 10, intelligence: 8, charisma: 8, combatSkill: 4 };
  check(T.calc('strength*0.7 + combat*0.8 + 5', stats) === 11 * 0.7 + 4 * 0.8 + 5 && T.calc('(2 + 3) * 4 - 6 / 2', {}) === 17, 'the calculator reads stat names, brackets and the four sums');
  const shove = T.read(CC.card('g_shove').formula, stats);
  check(shove.dmg === 9 && shove.fx.push === 1 && shove.fx.weak === 2, 'Shove: its damage, the push and the weakness', JSON.stringify(shove));
  const part = T.read(CC.card('a_part').formula, { agility: 11, combatSkill: 4 });
  check(part.dmg === 11 && part.block === 5 && part.fx.step === 1, 'Parting Shot: damage, block and the step back');
  check(T.read('draw: 1\nenergy: 1\nif target_has weak: damage: 9', stats).dmg === undefined, 'what a board has no use for (drawing, energy, conditions) is left out');
}
console.log('The kits');
{
  const every = Object.keys(T.KITS).every(k => T.KITS[k].abilities.every(a => CC.card(a.key)) && CC.PACKS[k]);
  check(Object.keys(T.KITS).join() === 'guard,archer,wizard,hearthkeeper,villager' && every, 'a kit for each class, every ability a real class card');
  check(Object.keys(CC.TRADES).every(kind => T.TRADE_KIT[CC.TRADES[kind]]), 'and a board form of every trade card');
  const guard = T.partyUnit({ id: 1, name: 'G', role: 'soldier' }, 'guard', 'trained', null), wiz = T.partyUnit({ id: 2, name: 'W', role: 'farmer' }, 'wizard', 'trained', null), vil = T.partyUnit({ id: 3, name: 'V', role: 'farmer' }, 'villager', 'villager', 't_ration');
  const ab = (u, k) => u.abilities.find(a => a.key === k);
  check(guard.abilities.length === 5 && ab(guard, 'g_strike').dmg === 16 && ab(guard, 'g_strike').max === 1 && ab(guard, 'g_heavy').cooldown === 3 && ab(guard, 'g_shield').target === 'self', 'a trained Guard: Strike for 16 at reach 1, Heavy Blow every fourth turn');
  check(ab(wiz, 'w_bolt').dmg === 16 && ab(wiz, 'w_bolt').max === 4 && ab(wiz, 'w_burst').shape === 'burst' && wiz.stats.intelligence === 11, 'any citizen can be tried as a Wizard: the level gives the class its stats');
  check(vil.abilities.length === 3 && ab(vil, 't_ration').heal === 7 && ab(vil, 't_ration').uses === 1 && vil.armour === 0, 'a villager has Swing, Duck and their trade card');
  check(guard.maxHp > vil.maxHp && guard.armour === 2, 'a level sets health and armour as the simulator\'s levels do');
  const ogre = T.creatureUnit({ id: 'hill_ogre', name: 'Hill Ogre', icon: '👹', max_hp: 60, strength: 11, agility: 3, endurance: 10, combat_skill: 3, moves: [{ key: 'club', name: 'Club', intent: 'attack', target: 'enemy', weight: 2, formula: 'damage: strength*0.9 + 2' }] }, 0, 'orange', { hp: 0.5 });
  check(ogre.maxHp === Math.round(60 * (1 + T.TIERS.orange.hp + 0.5)) && ogre.abilities[0].dmg === Math.round(Math.round(11 * (1 + T.TIERS.orange.str)) * 0.9 + 2) && ogre.move === 2, 'a creature takes the skull\'s health and strength, and a room\'s own boost');
  const rat = T.creatureUnit({ id: 'marsh_rat', name: 'Marsh Rat', max_hp: 22, strength: 5, agility: 9, endurance: 4, combat_skill: 2, moves: [] }, 0, 'green', null);
  check(rat.abilities.length === 1 && rat.abilities[0].dmg > 0 && rat.abilities[0].max === 1, 'a creature with no moves of its own bites');
}

async function part2() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const adminId = Number(process.env.CRAFTING_TEST_ADMIN_ID) || 0;
  const { query } = require('../db');
  const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const call = async (uid, method, p, body) => {
    const r = await fetch(BASE + p, { method, headers: { Authorization: 'Bearer ' + jwt.sign({ userId: uid, username: 't', species: 'Mice' }, secret), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  console.log('The routes');
  const town = (await query(`SELECT s.user_id FROM settlements s WHERE s.user_id = $1`, [adminId])).rows[0];
  if (!adminId || !town) { check(false, 'needs CRAFTING_TEST_ADMIN_ID with a town'); return; }
  const stranger = 987654321;   // nobody's id, and no admin's
  check((await call(stranger, 'POST', '/api/tactics/admin/setup', {})).status === 403 && (await call(stranger, 'GET', '/api/tactics/admin/options')).status === 403, 'only admins may use them');
  const o = await call(adminId, 'GET', '/api/tactics/admin/options');
  check(o.status === 200 && o.body.classes.length === 5 && o.body.tiers.length === 5 && o.body.lands.length === 7 && o.body.fights.length === 3 && o.body.levels.some(l => l.key === 'skull') && o.body.levels.some(l => l.key === 'as_is'), 'the choices: five classes, five skulls, seven lands, three fights, the levels');
  const before = (await query('SELECT COUNT(*)::int AS n FROM dungeons')).rows[0].n + ':' + (await query('SELECT COUNT(*)::int AS n FROM settlement_quests')).rows[0].n;
  const a = await call(adminId, 'POST', '/api/tactics/admin/setup', { classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'trained', tier: 'orange', terrain: 'hills', seed: 42 });
  check(a.status === 200 && a.body.party.length === 4 && a.body.party.map(u => u.cls).join() === 'guard,hearthkeeper,archer,wizard' && a.body.enemies.length >= 2 && a.body.seed === 42 && a.body.land === 'hills',
    'a setup: four citizens in the classes chosen, a group of creatures, the seed and the land', a.body.party.map(u => u.name).join(', '));
  check(a.body.party.every(u => u.abilities.length === 5 && u.maxHp > 0 && u.move >= 1 && u.abilities.every(x => x.name && x.icon && (x.dmg || x.block || x.heal || Object.keys(x.fx).length))) && a.body.enemies.every(u => u.abilities.length >= 1 && u.maxHp > 0),
    'every unit has health, a move and abilities that do something');
  const b = await call(adminId, 'POST', '/api/tactics/admin/setup', { classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'trained', tier: 'orange', terrain: 'hills', seed: 42 });
  check(JSON.stringify(a.body.enemies) === JSON.stringify(b.body.enemies) && JSON.stringify(a.body.party) === JSON.stringify(b.body.party), 'the same choices and seed give the same two sides');
  const boss = await call(adminId, 'POST', '/api/tactics/admin/setup', { tier: 'orange', terrain: 'hills', seed: 42, fight: 'boss', level: 'skull' });
  check(boss.status === 200 && boss.body.fight === 'boss' && boss.body.level === 'trained' && boss.body.enemies.reduce((n, u) => n + u.maxHp, 0) > a.body.enemies.reduce((n, u) => n + u.maxHp, 0) * 0.9, '"the boss" is the dungeon\'s last fight; "what the skull expects" is trained at orange');
  const asIs = await call(adminId, 'POST', '/api/tactics/admin/setup', { level: 'as_is', tier: 'green', terrain: 'forest' });
  check(asIs.status === 200 && asIs.body.level === 'as_is' && asIs.body.party.length === 4 && asIs.body.seed > 0, 'with no classes or level named, the citizens come as they are, in their own classes, on a fresh seed', asIs.body.party.map(u => u.label).join(', '));
  check((await call(adminId, 'POST', '/api/tactics/admin/setup', { tier: 'pink', terrain: 'moon' })).body.tier === 'green', 'an unknown skull or land falls back to green forest');
  const after = (await query('SELECT COUNT(*)::int AS n FROM dungeons')).rows[0].n + ':' + (await query('SELECT COUNT(*)::int AS n FROM settlement_quests')).rows[0].n;
  check(before === after, 'a setup alone stores nothing: no dungeon, no battle row');

  // ── Battles the server keeps ────────────────────────────────────────────
  console.log('Battles the server keeps');
  const E = require('../lib/tactics_engine');
  const fe = path.join(process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend'), 'js', 'tactics-engine.js');
  if (fs.existsSync(fe)) check(fs.readFileSync(fe, 'utf8') === fs.readFileSync(path.join(__dirname, '..', 'lib', 'tactics_engine.js'), 'utf8'), 'the server and the browser run the same rules, byte for byte');
  check((await call(stranger, 'POST', '/api/tactics/battles', {})).status === 403 && (await call(stranger, 'GET', '/api/tactics/battles/current')).status === 403, 'only admins, for now');
  const opts = { classes: ['guard', 'hearthkeeper', 'archer', 'wizard'], level: 'trained', tier: 'green', terrain: 'plains', seed: 77 };
  let r = await call(adminId, 'POST', '/api/tactics/battles', opts);
  let bt = r.body.battle;
  check(r.status === 200 && bt.id > 0 && bt.status === 'active' && bt.count === 0 && bt.setup.party.length === 4 && bt.setup.seed === 77 && typeof bt.check === 'string', 'a battle is created and stored: its two sides, no choices yet, the board\'s fingerprint');
  check((await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle.id === bt.id, 'it is the town\'s open battle');
  // The browser's copy, played alongside.
  const mine = E.replay(bt.setup, []).state;
  check(E.checksum(mine) === bt.check, 'the browser\'s copy starts on the same board');
  const who = E.current(mine), to = [...E.reach(mine, who).values()].filter(nd => nd.stop && nd.cost)[0];
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'move', x: 0, y: 0, extra: 'junk' } });
  check(r.status === 400 && r.body.battle && r.body.battle.count === 0, 'a move the rules do not allow is refused, nothing is stored, and the answer says where the battle stands');
  check((await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'teleport' } })).status === 400, 'so is a move the game does not know');
  check((await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 3, action: { t: 'move', x: to.x, y: to.y } })).status === 409, 'a choice out of step is refused (the battle has moved on)');
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'move', x: to.x, y: to.y, extra: 'junk' } });
  E.apply(mine, { t: 'move', x: to.x, y: to.y });
  check(r.status === 200 && r.body.battle.count === 1 && r.body.battle.check === E.checksum(mine) && JSON.stringify(r.body.battle.actions[0]) === JSON.stringify({ t: 'move', x: to.x, y: to.y }), 'a good move is stored (and only what a move may hold); both sides agree on the board');
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 0, action: { t: 'move', x: to.x, y: to.y } });
  check(r.status === 200 && r.body.battle.repeated === true && r.body.battle.count === 1, 'the same choice sent twice is taken once');
  r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: 1, action: { t: 'undo' } }); E.apply(mine, { t: 'undo' });
  check(r.status === 200 && r.body.battle.check === E.checksum(mine), 'a move can be taken back on the server too');
  // Play it out: the mind chooses for the party, every choice goes through the server.
  let n = 2, agree = true, refused = 0;
  for (let g = 0; g < 400 && mine.status === 'active'; g++) {
    const u = E.current(mine), keep = mine.r, p = E.plan(mine); mine.r = keep;
    const acts = [];
    if (p && p.to && (p.to.x !== u.x || p.to.y !== u.y)) acts.push({ t: 'move', x: p.to.x, y: p.to.y });
    if (p && p.ability) acts.push({ t: 'use', key: p.ability, x: p.x, y: p.y });
    acts.push({ t: 'end', face: ['n', 'e', 's', 'w'][g % 4] });
    for (const a of acts) {
      if (mine.status !== 'active') break;
      if (!E.apply(mine, a)) { refused++; continue; }
      r = await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n: n++, action: a });
      if (r.status !== 200 || r.body.battle.check !== E.checksum(mine)) { agree = false; break; }
    }
    if (!agree) break;
  }
  bt = r.body.battle;
  check(agree && mine.status !== 'active', `a whole battle played through the server: ${n} choices, the two sides agree after every one`, `${mine.status}, ${refused} refused locally`);
  check(bt.status === mine.status && bt.result && bt.result.status === mine.status && bt.result.party.length === 4 && bt.result.rounds === mine.round && bt.result.turns === mine.stats.turns
    && JSON.stringify(bt.result.party.map(x => [x.id, x.citizen_id, x.hp, x.maxHp, x.down])) === JSON.stringify(E.resultOf(mine).party.map(x => [x.id, x.citizen_id, x.hp, x.maxHp, x.down])),
    'when it ends the server records how: who won, the rounds, each citizen\'s health and who is down', JSON.stringify(bt.result).slice(0, 110));
  check((await call(adminId, 'POST', `/api/tactics/battles/${bt.id}/act`, { n, action: { t: 'end' } })).status === 400 && (await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle === null, 'a finished battle takes no more choices, and the town has no open battle');
  const stored = (await query('SELECT actions, status FROM tactics_battles WHERE id=$1', [bt.id])).rows[0];
  const again = E.replay(bt.setup, stored.actions);
  check(again.bad === -1 && E.checksum(again.state) === E.checksum(mine) && stored.actions.length === n, 'played again from what is stored, the battle comes out the same');
  // One open battle a town; leaving.
  const b1 = (await call(adminId, 'POST', '/api/tactics/battles', opts)).body.battle, b2 = (await call(adminId, 'POST', '/api/tactics/battles', { ...opts, seed: 78 })).body.battle;
  check((await call(adminId, 'GET', `/api/tactics/battles/${b1.id}`)).body.battle.status === 'left' && (await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle.id === b2.id, 'starting another ends the one before: a town has one open battle');
  r = await call(adminId, 'POST', `/api/tactics/battles/${b2.id}/leave`);
  check(r.status === 200 && r.body.battle.status === 'left' && (await call(adminId, 'GET', '/api/tactics/battles/current')).body.battle === null && (await call(adminId, 'POST', `/api/tactics/battles/${b2.id}/leave`)).body.battle.status === 'left', 'leaving ends it; leaving twice is no error');
  check((await call(adminId, 'GET', '/api/tactics/battles/999999999')).status === 404, 'another town\'s battle (or none) is not found');
}

(async () => {
  if (process.env.DATABASE_URL) { try { await part2(); } catch (e) { console.error(e); check(false, 'part 2 crashed: ' + e.message); } }
  else console.log('(no DATABASE_URL: the routes are not tested)');
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
