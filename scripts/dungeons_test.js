// ══════════════════════════════════════════════════════════════════════════
//  dungeons_test — a party's run through a dungeon (lib/dungeons.js,
//  lib/dungeon_defs.js, routes/dungeons.js; docs/DUNGEONS.md §10).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/dungeons_test.js
//  Part 1 needs nothing. Part 2 needs the database and the running server.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
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
  check(t.green.hp === 0.5 && t.green.str === 0.4 && t.purple.hp === 1.75 && t.purple.str === 1.4, 'creature health and strength: +50%/+40% at green, +175%/+140% at purple');
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
  const D = require('../lib/dungeons');
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
      for (let i = 0; i < hand.length && !played; i++) {
        const r = await api(p, 'POST', '/api/combat/action/' + questRunId, { action_key: 'card', hand_index: i, target_id: foe ? foe.id : null });
        if (r.status === 200) { b = r.body.battle; played = true; }
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
  // On a database with no card rows the code-defined cards do nothing in a
  // server battle (their effects read `this.scaling`, which the dispatcher
  // does not bind), so give the default deck's four cards real rows for this
  // run, with the same numbers, and take them away again at the end.
  const seededCards = !(await q('SELECT 1 FROM card_templates LIMIT 1')).rows.length;
  if (seededCards) {
    for (const c of [['strike', 'Strike', 1, 'attack', 'enemy', 'damage: strength*0.6 + combat*0.8 + 4'], ['defend', 'Defend', 1, 'defense', 'self', 'block: endurance*0.7 + combat*0.5 + 4'],
      ['quick_jab', 'Quick Jab', 0, 'attack', 'enemy', 'damage: agility*0.5 + combat*0.4 + 2'], ['rally', 'Rally', 1, 'support', 'ally', 'buff damage_bonus: charisma*0.4 + combat*0.2 + 2']]) {
      await q('INSERT INTO card_templates (card_key, name, cost, card_type, target, formula) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING', c);
    }
  }
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
    check(r.status === 200 && r.body.outcome === 'victory' && v && v.status === 'active' && v.room === 'a' && !v.room_open && v.moves.join() === 'b1,b2', 'after the win the party is back on the path, with two ways on');
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
    check(r.status === 200 && r.body.run.pending.kind === 'rest' && r.body.run.pending.options[0].key === 'rest' && r.body.run.moves.length === 0, 'a rest room asks before the party walks on');
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
    check(b.combat_mods.enemy_health === 1 && b.combat_mods.enemy_strength === 0.8, 'orange creatures: +100% health, +80% strength');
    await D.adminWin(o.id);
    await api(o, 'POST', '/api/dungeons/run/move', { room: 'b1' });
    r = await api(o, 'POST', '/api/dungeons/run/move', { room: 'c1' });
    b = (await q('SELECT combat_mods FROM settlement_quests WHERE id=$1', [r.body.quest_run_id])).rows[0];
    check(r.body.run.pending.room === 'elite' && b.combat_mods.enemy_health === 1.5, "an elite room's own boost is added to the skull's");
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

    // ── The switch ──────────────────────────────────────────────────────
    console.log('The switch');
    const g = await player('Gate');
    await D.startTest(g.id, 'test_green', g.cits.slice(0, 4));
    await TU.setSwitch('dungeons.on', false);
    r = await api(g, 'POST', '/api/dungeons/run/move', { room: 'a' });
    check(r.status === 403, 'with the switch off, a player cannot play a run');
    r = await api(g, 'GET', '/api/dungeons/run');
    check(r.status === 200 && r.body.on === false && r.body.run === null, 'and is told dungeons are not open');
    for (const p of [['GET', '/api/dungeons/admin/status'], ['POST', '/api/dungeons/admin/test'], ['POST', '/api/dungeons/admin/switch'], ['POST', '/api/dungeons/admin/sweep'], ['POST', '/api/dungeons/admin/heal'], ['POST', '/api/dungeons/admin/win']]) {
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
    if (seededCards) await q("DELETE FROM card_templates WHERE card_key IN ('strike','defend','quick_jab','rally')").catch(() => {});
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
