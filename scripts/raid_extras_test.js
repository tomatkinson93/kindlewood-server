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

  await pool.end();
}

(async () => {
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and QUEST_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
