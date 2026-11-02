// ══════════════════════════════════════════════════════════════════════════
//  raid_extras_test — call to arms (lib/raid_extras), and — once they land —
//  sallies and Withered camps (lib/raid_camps).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/raid_extras_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  const X = -20000 - Math.floor(Math.random() * 5000) * 20;
  async function player(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    await q("UPDATE users SET created_at = NOW() - interval '30 days' WHERE id=$1", [u.id]);
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'town',5000,5000,5000,5000,5000,$3,0,NOW()) RETURNING id`, [u.id, username, X + seq * 40])).rows[0];
    return { id: u.id, sid: s.id, q: X + seq * 40, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const cit = async (p, name, role) => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'male',$3,'{}','adult') RETURNING id`, [p.sid, name + RUN, role])).rows[0].id;
  const R = require('../lib/raids');

  console.log('Call to arms');
  const owner = await player('besieged'), ally = await player('ally'), stranger = await player('stranger');
  const clan = (await q("INSERT INTO clans (name, founder_user_id) VALUES ($1,$2) RETURNING id", ['Arms' + RUN, owner.id])).rows[0].id;
  await q("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'founder'),($3,$2,'member')", [owner.id, clan, ally.id]);
  const T = owner.q + 5;
  await q('INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id) VALUES ($1,0,$2,$3)', [T, clan, owner.id]);
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile')`, ['Warren' + RUN, T + 2]);
  const op = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, fort_level) VALUES ($1,$2,0,'plains',1,1) RETURNING id", [owner.sid, T])).rows[0].id;
  const raid = await R.start((await q('SELECT * FROM settlements WHERE id=$1', [owner.sid])).rows[0], { strength: 60 });
  check(raid && raid.outpost_id === op, 'raiders come for an outpost on clan land');
  const act = (await q("SELECT payload FROM clan_activity WHERE clan_id=$1 AND type='call_to_arms' ORDER BY id DESC LIMIT 1", [clan])).rows[0];
  check(act && act.payload.raid_id === raid.id, 'the clan hears the call');
  let r = await api(ally, 'GET', '/api/raids/calls');
  check(r.status === 200 && r.body.calls.length === 1 && r.body.calls[0].raid_id === raid.id && !r.body.calls[0].mine, 'a clanmate sees the call');
  const g1 = await cit(ally, 'Pike', 'soldier'), g2 = await cit(ally, 'Bolt', 'archer'), g3 = await cit(ally, 'Shield', 'soldier'), farmer = await cit(ally, 'Hoe', 'farmer');
  r = await api(ally, 'POST', `/api/raids/${raid.id}/reinforce`, { citizen_id: farmer });
  check(r.status === 400 && /Guards and Archers/.test(r.body.error), 'only Guards and Archers answer');
  r = await api(ally, 'POST', `/api/raids/${raid.id}/reinforce`, { citizen_id: g1 });
  const r2 = await api(ally, 'POST', `/api/raids/${raid.id}/reinforce`, { citizen_id: g2 });
  const r3 = await api(ally, 'POST', `/api/raids/${raid.id}/reinforce`, { citizen_id: g3 });
  check(r.status === 200 && r2.status === 200 && r3.status === 400 && /at most 2/.test(r3.body.error), 'a member sends up to two');
  const gs = await cit(stranger, 'Lone', 'soldier');
  check((await api(stranger, 'POST', `/api/raids/${raid.id}/reinforce`, { citizen_id: gs })).status === 403, 'outsiders can\'t');
  const busy = await api(ally, 'POST', '/api/quests/accept', { quest_id: 'q_gather_herbs', citizen_id: g1 });
  check(busy.status === 400, 'a reinforcement is busy');
  const g = await api(owner, 'GET', '/api/raids');
  check(g.body.defence.reinforcements === 18 && g.body.defence.reinforcement_list.length === 2, `the owner sees them in the defence (+${g.body.defence.reinforcements})`);
  await q('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [raid.id]);
  const done = await R.resolve(raid.id, () => 0.5);   // fort 10 + reinforcements 18 + clan land 10 = 38 vs 60 → partial
  check(done.outcome === 'partial' && done.defence === 38, `their defence counts (${done.defence} vs 60)`);
  const hurt = (await q("SELECT citizen_id FROM citizen_events WHERE event_type='injury' AND citizen_id = ANY($1::int[])", [[g1, g2]])).rows.length;
  check(hurt === 2, 'they share the injuries when the spot falls');
  check(!(await q('SELECT 1 FROM raid_reinforcements WHERE raid_id=$1', [raid.id])).rows.length, 'and come home when it ends');

  console.log('Scouted strength');
  const s2 = await player('scouted');
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile')`, ['Warren2' + RUN, s2.q + 2]);
  const r4 = await R.start((await q('SELECT * FROM settlements WHERE id=$1', [s2.sid])).rows[0], { strength: 100 });
  const view = (await api(s2, 'GET', '/api/raids')).body.active;
  check(view && view.strength === null && view.strength_min === 65 && view.strength_max === 135, 'the client sees only a range (±35% without scouts)');
  void r4;

  console.log('Sally out');
  const C = require('../lib/raid_camps');
  const so = await player('sally');
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile')`, ['Warren3' + RUN, so.q + 2]);
  const sr = await R.start((await q('SELECT * FROM settlements WHERE id=$1', [so.sid])).rows[0], { strength: 70 });
  const f1 = await cit(so, 'Ash', 'soldier'), f2 = await cit(so, 'Elm', 'archer');
  let x = await api(so, 'POST', `/api/raids/${sr.id}/sally`, { citizen_ids: [] });
  check(x.status === 400, 'a sally needs 1–3 citizens');
  x = await api(so, 'POST', `/api/raids/${sr.id}/sally`, { citizen_ids: [f1, f2] });
  const run = x.body.quest_run_id && (await q('SELECT * FROM settlement_quests WHERE id=$1', [x.body.quest_run_id])).rows[0];
  check(x.status === 200 && run && run.combat_status === 'pending' && run.quest_id === 'raid_sally' && run.combat_encounter.length === 2, 'sally out: a card battle waits (two Withered for strength 70)');
  const pend = await api(so, 'GET', '/api/combat/pending');
  check(pend.body.battles && pend.body.battles.some(b => b.id === run.id && b.quest_title === 'Sally Out'), '…in the Battles list, titled');
  check((await api(so, 'POST', `/api/raids/${sr.id}/sally`, { citizen_ids: [f1] })).status === 400, 'one sally per raid');
  await C.onBattleEnded(run, 'defeat');
  check(Number((await q('SELECT strength FROM settlement_raids WHERE id=$1', [sr.id])).rows[0].strength) === 88, 'a lost sally makes them 25% stronger');
  // A won sally breaks a raid.
  const so2 = await player('sally2');
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile')`, ['Warren4' + RUN, so2.q + 2]);
  const sr2 = await R.start((await q('SELECT * FROM settlements WHERE id=$1', [so2.sid])).rows[0], { strength: 50 });
  const h1 = await cit(so2, 'Oak', 'soldier');
  const x2 = await api(so2, 'POST', `/api/raids/${sr2.id}/sally`, { citizen_ids: [h1] });
  const run2 = (await q('SELECT * FROM settlement_quests WHERE id=$1', [x2.body.quest_run_id])).rows[0];
  const w0 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [so2.sid])).rows[0].wealth);
  await C.onBattleEnded(run2, 'victory');
  const sr2b = (await q('SELECT outcome, loss_share FROM settlement_raids WHERE id=$1', [sr2.id])).rows[0];
  check(sr2b.outcome === 'broken' && Number(sr2b.loss_share) === 0 && Number((await q('SELECT wealth FROM settlements WHERE id=$1', [so2.sid])).rows[0].wealth) === w0 + 80, 'a won sally breaks the raid: nothing lost, +80 wealth');
  check((await q('SELECT status FROM settlement_quests WHERE id=$1', [run2.id])).rows[0].status === 'collected', 'the sally run is closed (nothing for the notice board)');

  console.log('Withered camps');
  const home = await player('camper');
  const vq = home.q + 4;
  const vid = (await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile') RETURNING id`, ['Warren5' + RUN, vq])).rows[0].id;
  await C.spawnCamps();
  const camps = (await q('SELECT * FROM withered_camps WHERE npc_id=$1 AND cleared_at IS NULL', [vid])).rows;
  const dist = (a, b) => require('../mapgen').hexDistanceWrapped(a.q, a.r, b.q, b.r);
  check(camps.length === 2 && camps.every(c => dist(c, { q: vq, r: 0 }) <= 3 && dist(c, { q: vq, r: 0 }) >= 2), 'two camps near each Withered village');
  await C.spawnCamps();
  check(Number((await q('SELECT COUNT(*)::int AS n FROM withered_camps WHERE npc_id=$1 AND cleared_at IS NULL', [vid])).rows[0].n) === 2, '…and no more');
  const camp = camps[0];
  const p1 = await cit(home, 'Rowan', 'soldier'), p2 = await cit(home, 'Briar', 'archer');
  x = await api(home, 'POST', `/api/raids/camps/${camp.id}/assault`, { citizen_ids: [p1, p2] });
  check(x.status === 400 && /Scout/.test(x.body.error), 'you must have seen the camp');
  await q('INSERT INTO fog_of_war (user_id, tile_q, tile_r) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [home.id, camp.q, camp.r]);
  const list = await api(home, 'GET', '/api/raids/camps');
  check(list.body.camps.some(c => c.id === camp.id && c.in_reach), 'GET /api/raids/camps lists it, in reach');
  x = await api(home, 'POST', `/api/raids/camps/${camp.id}/assault`, { citizen_ids: [p1, p2] });
  const crun = x.body.quest_run_id && (await q('SELECT * FROM settlement_quests WHERE id=$1', [x.body.quest_run_id])).rows[0];
  check(x.status === 200 && crun && crun.quest_id === 'camp_assault' && crun.combat_status === 'pending', 'assault: a party card battle');
  const neighbour = await player('neighbour');
  await q('UPDATE settlements SET tile_q = $2 WHERE id=$1', [neighbour.sid, camp.q + 1]);
  await C.onBattleEnded(crun, 'victory');
  const cleared = (await q('SELECT cleared_at FROM withered_camps WHERE id=$1', [camp.id])).rows[0].cleared_at;
  const peace = (await q('SELECT raid_peace_until FROM settlements WHERE id=$1', [neighbour.sid])).rows[0].raid_peace_until;
  check(cleared && peace && Date.parse(peace) > Date.now() + 71 * 3600e3, 'cleared: three days of peace for towns nearby');
  const wf = await R.withered((t, p) => q(t, p));
  check(wf.some(b => b.camp_id && b.camp_id === camps[1].id) && !wf.some(b => b.camp_id === camp.id), 'raids now set out from the remaining camp');

  await pool.end();
}

(async () => {
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and QUEST_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
