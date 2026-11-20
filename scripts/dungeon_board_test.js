// Dungeons fought on the board (docs/TACTICS.md §9, Phase 3): a run whose
// fights are tactics battles kept by the server, with health and who is down
// carried between them.
//   DATABASE_URL=… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/dungeon_board_test.js
'use strict';
const jwt = require('jsonwebtoken');
let pass = 0, fail = 0;
const check = (ok, name, extra) => { console.log((ok ? '  ok   ' : '  FAIL ') + name + (extra ? ' — ' + extra : '')); ok ? pass++ : fail++; };

async function main() {
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const { pool } = require('../db');
  const q = (t, p) => pool.query(t, p);
  const E = require('../lib/tactics_engine');
  const D = require('../lib/dungeons');
  const TU = require('../lib/tuning');
  const RUN = Date.now().toString(36);
  let seq = 0;
  // A town with six grown-ups; `strong` ones win their fights, weak ones lose them.
  async function player(name, strong = true) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'village',1000,1000,1000,1000,1000,$3,0,NOW()) RETURNING id`, [u.id, username, 9000 + (Date.now() % 100000) + seq * 40])).rows[0];
    const stats = strong ? { strength: 30, agility: 14, endurance: 20, intelligence: 12, charisma: 10 } : { strength: 1, agility: 1, endurance: 1, intelligence: 1, charisma: 1 };
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
  const wealth = async p => Number((await q('SELECT wealth FROM settlements WHERE id=$1', [p.sid])).rows[0].wealth);
  // Fight a battle on the board through the routes, the engine's mind choosing for the party.
  // → the last answer (which carries `dungeon` once the battle has ended).
  async function fight(p, battleId, { until = null } = {}) {
    let bt = (await api(p, 'GET', '/api/tactics/battles/' + battleId)).body.battle, last = null;
    const st = E.replay(bt.setup, bt.actions).state;
    let n = bt.count;
    for (let g = 0; g < 500 && st.status === 'active'; g++) {
      if (until && until(st)) break;
      const u = E.current(st), keep = st.r, plan = E.plan(st); st.r = keep;
      const acts = [];
      if (plan && plan.to && (plan.to.x !== u.x || plan.to.y !== u.y)) acts.push({ t: 'move', x: plan.to.x, y: plan.to.y });
      if (plan && plan.ability) acts.push({ t: 'use', key: plan.ability, x: plan.x, y: plan.y });
      acts.push({ t: 'end' });
      for (const a of acts) {
        if (st.status !== 'active' || !E.apply(st, a)) continue;
        last = await api(p, 'POST', `/api/tactics/battles/${battleId}/act`, { n: n++, action: a });
        if (last.status !== 200) return { last, st, broke: true };
      }
    }
    return { last, st };
  }
  const wasOn = await TU.switchOn('dungeons.on');
  await TU.setSwitch('dungeons.on', true);
  try {
    console.log('A dungeon on the board');
    const a = await player('Board');
    const party = a.cits.slice(0, 4);
    let r = await D.startTest(a.id, 'test_green', party, { combat: 'board' });
    let v = r.run;
    check(v.status === 'active' && v.combat === 'board' && v.pending === null && v.moves.join() === 'a' && v.party.every(m => m.deck === null),
      'a run on the board starts at the door: no decks, no card to choose, the way in open');
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'a' });
    v = r.body.run;
    const b1 = r.body.board_battle_id;
    check(r.status === 200 && b1 > 0 && v.pending.kind === 'battle' && v.pending.board === true && v.pending.battle_id === b1 && v.can_flee && !v.can_leave && r.body.quest_run_id === null,
      'entering a fight room opens a battle on the board, not a card battle');
    let bt = (await api(a, 'GET', '/api/tactics/battles/' + b1)).body.battle;
    check(bt.source === 'dungeon' && bt.dungeon_run_id === v.id && bt.setup.party.length === 4 && bt.setup.party.map(u => u.cls).join() === 'guard,archer,villager,villager'
      && bt.setup.enemies.map(e => e.key).join() === 'night_wolf,thornback_boar,night_wolf' && bt.setup.land === 'forest' && bt.setup.fight === 'fight',
      'the battle is the room: the party in their own classes, the room\'s creatures, the dungeon\'s land');
    check(bt.setup.party.every((u, i) => u.maxHp === v.party[i].max && (u.hp == null || u.hp === v.party[i].hp)), 'each citizen comes in with the health the run has for them');
    check((await api(a, 'POST', '/api/dungeons/run/move', { room: 'b1' })).status === 400 && (await api(a, 'POST', '/api/dungeons/run/leave')).status === 400, 'the party cannot walk on or turn back until the fight is over');
    check((await api(a, 'POST', '/api/tactics/battles', { tier: 'green' })).status !== 200, 'a practice battle cannot push a dungeon\'s battle aside');
    const lootBefore = v.loot.wealth;
    let f = await fight(a, b1);
    const d1 = f.last.body.dungeon;
    check(f.st.status === 'victory' && f.last.body.battle.status === 'victory' && d1 && d1.ended === false && d1.run.pending === null && d1.run.moves.join() === 'b1,b2',
      'winning it on the board puts the party back on the path, the ways on open', `${f.st.round} rounds`);
    const after = E.resultOf(f.st).party;
    check(d1.run.party.every(m => { const u = after.find(x => x.citizen_id === m.id); return u && m.hp === Math.max(u.down ? 0 : 1, u.hp) && m.down === u.down; }),
      'the run now has each citizen\'s health as the battle left it', d1.run.party.map(m => `${m.hp}/${m.max}`).join(' '));
    check(d1.run.loot.wealth > lootBefore && d1.found && d1.found.wealth > 0, 'the fight\'s wealth joins the run\'s loot', `+${d1.found.wealth}`);
    // The second fight starts from the first one's wounds.
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'b2' });
    const b2 = r.body.board_battle_id;
    bt = (await api(a, 'GET', '/api/tactics/battles/' + b2)).body.battle;
    const carried = bt.setup.party.every(u => { const m = d1.run.party.find(x => x.id === u.citizen_id); return (u.hp == null ? u.maxHp : u.hp) === m.hp; });
    check(b2 > b1 && carried && bt.setup.party.length === d1.run.party.filter(m => !m.down).length, 'the next fight begins with those wounds; anyone who is down stays off the board');
    // Leave the page in the middle of it: the battle is still there, part-played.
    f = await fight(a, b2, { until: st => st.round >= 2 });
    const mid = (await api(a, 'GET', '/api/tactics/battles/current')).body.battle;
    check(mid && mid.id === b2 && mid.count > 0 && mid.status === 'active' && (await api(a, 'GET', '/api/dungeons/run')).body.run.pending.battle_id === b2, 'a battle left part-played is still the run\'s open fight, with its choices kept');
    f = await fight(a, b2);
    check(f.last.body.dungeon && f.last.body.dungeon.run.moves.join() === 'c1,c2', 'picked up and won');
    // Rest, then the boss.
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'c2' });
    check(r.body.run.pending.kind === 'rest' && r.body.run.pending.options.map(o => o.key).join() === 'rest', 'a rest room on the board offers a rest (there are no cards to hone)');
    const hurt = r.body.run.party.map(m => m.hp);
    r = await api(a, 'POST', '/api/dungeons/run/choose', { option: 'rest' });
    check(r.body.run.party.every((m, i) => m.hp >= hurt[i] && !m.down), 'resting heals as before');
    await api(a, 'POST', '/api/dungeons/run/move', { room: 'd2' });
    r = await api(a, 'POST', '/api/dungeons/run/move', { room: 'boss' });
    const b3 = r.body.board_battle_id, w0 = await wealth(a);
    bt = (await api(a, 'GET', '/api/tactics/battles/' + b3)).body.battle;
    check(bt.setup.fight === 'boss' && r.body.run.pending.room === 'boss', 'the last room is the boss, on the board');
    f = await fight(a, b3);
    const end = f.last.body.dungeon;
    check(f.st.status === 'victory' && end.ended === true && end.run.status === 'cleared' && end.run.result.fights === 3 && end.run.result.kept.wealth > 0 && (await wealth(a)) === w0 + end.run.result.kept.wealth,
      'the boss falling clears the dungeon: the loot is paid and the run is over', `kept ${end.run.result.kept.wealth}`);
    check((await q(`SELECT COUNT(*)::int AS n FROM tactics_battles WHERE dungeon_run_id=$1 AND status='victory'`, [end.run.id])).rows[0].n === 3 && (await q(`SELECT COUNT(*)::int AS n FROM settlement_quests WHERE dungeon_run_id=$1`, [end.run.id])).rows[0].n === 0,
      'three battles on the board, and no card battle, were fought for it');

    console.log('Losing, fleeing, and the shortcuts');
    const weak = await player('Weak', false);
    await D.startTest(weak.id, 'test_green', weak.cits.slice(0, 4), { combat: 'board' });
    r = await api(weak, 'POST', '/api/dungeons/run/move', { room: 'a' });
    f = await fight(weak, r.body.board_battle_id);
    const lost = f.last.body.dungeon;
    check(f.st.status === 'defeat' && lost.ended === true && lost.run.status === 'defeat' && lost.run.result.rolled.length === 4, 'a defeat on the board ends the run, and everyone rolls for injury');
    const fl = await player('Flee');
    await D.startTest(fl.id, 'test_green', fl.cits.slice(0, 4), { combat: 'board' });
    r = await api(fl, 'POST', '/api/dungeons/run/move', { room: 'a' });
    await fight(fl, r.body.board_battle_id);
    r = await api(fl, 'POST', '/api/dungeons/run/move', { room: 'b2' });
    const fb = r.body.board_battle_id, carriedLoot = r.body.run.loot.wealth;
    await fight(fl, fb, { until: st => st.round >= 2 });
    r = await api(fl, 'POST', '/api/dungeons/run/flee');
    check(r.status === 200 && r.body.run.status === 'fled' && r.body.run.result.kept.wealth === Math.floor(carriedLoot * D.CONFIG.FLEE_KEEP) || r.body.run.result.kept.wealth === Math.round(carriedLoot * D.CONFIG.FLEE_KEEP),
      'fleeing a fight on the board ends the run with half the loot', `${carriedLoot} → ${r.body.run && r.body.run.result.kept.wealth}`);
    check((await api(fl, 'GET', '/api/tactics/battles/' + fb)).body.battle.status === 'left' && (await api(fl, 'POST', `/api/tactics/battles/${fb}/act`, { n: 0, action: { t: 'end' } })).status !== 200, 'and the battle is closed: it takes no more choices');
    const wo = await player('Walk');
    await D.startTest(wo.id, 'test_green', wo.cits.slice(0, 4), { combat: 'board' });
    r = await api(wo, 'POST', '/api/dungeons/run/move', { room: 'a' });
    r = await api(wo, 'POST', `/api/tactics/battles/${r.body.board_battle_id}/leave`);
    check(r.status === 200 && r.body.battle.status === 'left' && r.body.dungeon && r.body.dungeon.run.status === 'fled', 'walking out of a dungeon\'s battle is fleeing the dungeon');
    const win = await player('DevWin');
    await D.startTest(win.id, 'test_green', win.cits.slice(0, 4), { combat: 'board' });
    r = await api(win, 'POST', '/api/dungeons/run/move', { room: 'a' });
    const wb = r.body.board_battle_id;
    const won = await D.adminWin(win.id);
    check(won.run.pending === null && won.run.moves.join() === 'b1,b2' && (await q('SELECT status FROM tactics_battles WHERE id=$1', [wb])).rows[0].status === 'victory', 'Dev Tools can win the open fight on the board');
    // Idle for a day in a fight: the run ends by itself.
    await api(win, 'POST', '/api/dungeons/run/move', { room: 'b2' });
    await q(`UPDATE dungeon_runs SET last_action_at = NOW() - make_interval(hours => $2) WHERE settlement_id=$1 AND status='active'`, [win.sid, D.CONFIG.IDLE_HOURS + 1]);
    await D.sweep();
    const idle = (await q('SELECT status, board_battle_id FROM dungeon_runs WHERE settlement_id=$1 ORDER BY id DESC LIMIT 1', [win.sid])).rows[0];
    check(idle.status === 'timed_out' && idle.board_battle_id === null, 'a run left idle in a fight on the board ends by itself');

    console.log('Generated dungeons, and cards still work');
    const g = await player('Gen');
    r = await D.startGenerated(g.id, { tier: 'yellow', terrain: 'hills', seed: 4321 }, g.cits.slice(0, 4), { combat: 'board' });
    let gv = r.run, rooms = 0, fights = 0;
    for (let guard = 0; gv && gv.status === 'active' && guard < 60; guard++) {
      if (gv.pending && gv.pending.kind === 'battle') { const x = await fight(g, gv.pending.battle_id); fights++; gv = x.last.body.dungeon.run; }
      else if (gv.pending) gv = (await api(g, 'POST', '/api/dungeons/run/choose', { option: gv.pending.options.some(o => o.key === 'rest') ? 'rest' : 'deeper' })).body.run;
      else { gv = (await api(g, 'POST', '/api/dungeons/run/move', { room: gv.moves[0] })).body.run; rooms++; }
    }
    check(gv && (gv.status === 'cleared' || gv.status === 'defeat') && fights >= 2, 'a generated dungeon is walked to its end on the board', `${gv && gv.status}, ${fights} fights in ${rooms} rooms`);
    const c = await player('Cards');
    r = await D.startTest(c.id, 'test_green', c.cits.slice(0, 4));
    check(r.run.combat === 'cards' && r.run.pending && r.run.pending.kind === 'door', 'a run started the old way is still a card run, door pick and all');
    await api(c, 'POST', '/api/dungeons/run/leave').catch(() => {});
    // Only the town whose battle it is.
    check((await api(weak, 'GET', '/api/tactics/battles/' + b1)).status === 404, 'another town cannot see or play this town\'s battle');
    await TU.setSwitch('dungeons.on', false);
    check((await api(a, 'GET', '/api/tactics/battles/' + b1)).status === 403, 'with dungeons switched off for players, a player cannot reach the battle routes');
  } finally { await TU.setSwitch('dungeons.on', wasOn); }
}

(async () => {
  if (!process.env.DATABASE_URL) { console.log('(no DATABASE_URL: skipped)'); process.exit(0); }
  try { await main(); } catch (e) { console.error(e); check(false, 'crashed: ' + e.message); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
