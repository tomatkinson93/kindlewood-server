// ══════════════════════════════════════════════════════════════════════════
//  outposts_test — upgrading an outpost (POST /api/game/outposts/:id/upgrade).
//
//  Part 1 is pure (outposts_config). Part 2 uses the database and a running
//  server:
//
//   node scripts/outposts_test.js
//   DATABASE_URL=postgres://… TRAVEL_TEST_BASE=http://localhost:3999 node scripts/outposts_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const C = require('../outposts_config');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  console.log('Costs');
  check(C.OUTPOST_MAX_LEVEL === 3, 'outposts go up to level 3');
  check(JSON.stringify(C.upgradeCost(2)) === JSON.stringify({ timber: 360, stone: 180, wealth: 90 }), 'Lv2 costs the founding cost × 2 × 1.5');
  const c3 = C.upgradeCost(3);
  check(c3.timber === 540 && c3.bronze === 15, 'Lv3 costs × 3 × 1.5, plus 15 bronze');
  check(C.upgradeCost(2, 0.9).timber === 324, 'building discounts apply');
  check(C.OUTPOST_LEVEL_TIER[3] === 'town' && !C.OUTPOST_LEVEL_TIER[2], 'Lv3 needs a Town; Lv2 doesn\'t');
  check(C.outpostYields('hills', 2).stone === 2 * C.outpostYields('hills', 1).stone, 'yields scale with level');

  console.log('Second yields, multipliers, refunds');
  check(C.SECONDARY_YIELDS_ENABLED && C.outpostYields('hills', 1).metal === 1 && C.outpostYields('river', 2).food === 4, 'a second, smaller yield per terrain (× level)');
  check(C.outpostYields('plains', 1, 1.5).food === 9 && C.outpostYields('plains', 1, 0.5).food === 3 && C.outpostYields('plains', 2, 0).food === 0, 'a multiplier scales every yield, in whole units');
  check(JSON.stringify(C.dismantleRefund(1)) === JSON.stringify({ timber: 60, stone: 30, wealth: 15 }), 'dismantling Lv1 gives back half the build cost');
  const r3 = C.dismantleRefund(3);
  check(r3.timber === Math.floor((120 + 360 + 540) / 2) && r3.bronze === 7, '…and half of each upgrade paid (Lv3: bronze too)');
  const S = require('../lib/outpost_state');
  const w = S.annotate({ terrain: 'hills', assigned_citizen_id: 1, worker_name: 'Bo', worker_role: 'miner' }, {});
  const w2 = S.annotate({ terrain: 'hills', assigned_citizen_id: 1, worker_name: 'Bo', worker_role: 'farmer' }, { outposts_unfed_since: new Date() });
  check(w.mult === 1.5 && w.worker.fit, 'a Miner at a Quarry: +50%');
  check(w2.mult === 0.625 && w2.notes.some(n => n.key === 'unfed'), 'a Farmer there +25%, and unfed halves it (×0.625)');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.TRAVEL_TEST_BASE || process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;

  async function user(name, tier) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, bronze, last_tick)
                        VALUES ($1,$2,2,$3,5000,5000,5000,5000,5000,0,NOW()) RETURNING *`, [u.id, username, tier])).rows[0];
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  // Somewhere far off the real map, so it never meets a real tile.
  const spot = () => [-5000 - Math.floor(Math.random() * 100000), -5000 - seq++];
  async function outpost(p, terrain = 'hills') {
    const [tq, tr] = spot();
    return (await q('INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,$3,$4,1) RETURNING id', [p.sid, tq, tr, terrain])).rows[0].id;
  }
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const res = async sid => (await q('SELECT timber, stone, wealth, bronze FROM settlements WHERE id=$1', [sid])).rows[0];

  console.log('Upgrading');
  const a = await user('opup', 'village');
  const id = await outpost(a);
  let r = await api(a, 'GET', '/api/game/outposts');
  let o = (r.body.outposts || []).find(x => x.id === id);
  check(o && o.level === 1 && o.max_level === 3 && o.next && o.next.level === 2 && o.next.cost.timber === 360 && o.next.tierMet === true,
    'GET /outposts: each outpost says what its next level costs');
  check(o && o.next.yields.stone === 2 * o.yields.stone && o.next.ores.copper > o.ores.copper && o.next.upkeep_food_per_hr === 2, '…and what it gives and eats');
  const before = await res(a.sid);
  r = await api(a, 'POST', `/api/game/outposts/${id}/upgrade`);
  const after = await res(a.sid);
  check(r.status === 200 && r.body.outpost.level === 2 && r.body.outpost.upkeep_food_per_hr === 2, 'upgrade to Lv2' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  check(before.timber - after.timber === 360 && before.stone - after.stone === 180 && before.wealth - after.wealth === 90, 'it charges the Lv2 cost');
  check(r.body.resources && r.body.rates && r.body.rates.stone > 0, 'fresh resources and rates come back for the top bar');
  const lvl = (await q('SELECT level FROM outposts WHERE id=$1', [id])).rows[0].level;
  check(lvl === 2, 'the outpost is level 2');

  console.log('Upkeep');
  const bd = await api(a, 'GET', '/api/game/resource-breakdown');
  const up = ((bd.body.breakdown || {}).food || { sources: [] }).sources.find(s => s.kind === 'outpost_upkeep');
  check(up && up.value === -2, `a Lv2 outpost eats 2 food an hour (${up && up.value})`);
  const ore = (bd.body.breakdown || {}).copper;
  check(!ore || ore.sources.some(s => s.kind === 'outpost'), 'its ores show in the breakdown (once research allows)');

  console.log('Limits');
  r = await api(a, 'POST', `/api/game/outposts/${id}/upgrade`);
  check(r.status === 400 && /needs a Town/.test(r.body.error), 'Lv3 needs a Town');
  await q("UPDATE settlements SET tier = 'town' WHERE id=$1", [a.sid]);
  r = await api(a, 'POST', `/api/game/outposts/${id}/upgrade`);
  check(r.status === 400 && /bronze/i.test(r.body.error), '…and 15 bronze');
  await q('UPDATE settlements SET bronze = 20 WHERE id=$1', [a.sid]);
  r = await api(a, 'POST', `/api/game/outposts/${id}/upgrade`);
  check(r.status === 200 && r.body.outpost.level === 3 && r.body.outpost.next === null && (await res(a.sid)).bronze === 5, 'a Town with bronze: Lv3, the top');
  r = await api(a, 'POST', `/api/game/outposts/${id}/upgrade`);
  check(r.status === 400 && /already level 3/.test(r.body.error), 'no level 4');

  const b = await user('opother', 'town');
  const theirs = await outpost(b);
  r = await api(a, 'POST', `/api/game/outposts/${theirs}/upgrade`);
  check(r.status === 404 && (await q('SELECT level FROM outposts WHERE id=$1', [theirs])).rows[0].level === 1, 'nobody upgrades someone else\'s outpost');
  await q('UPDATE settlements SET timber = 10 WHERE id=$1', [b.sid]);
  r = await api(b, 'POST', `/api/game/outposts/${theirs}/upgrade`);
  check(r.status === 400 && /timber/i.test(r.body.error), 'short of timber: refused, nothing spent');

  console.log('Workers');
  const wk = await user('opwork', 'village');
  const wid = await outpost(wk, 'hills');
  const cit = async (name, role) => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'female',$3,'{}','adult') RETURNING id`, [wk.sid, name + RUN, role])).rows[0].id;
  const miner = await cit('Pick', 'miner'), farmer = await cit('Hoe', 'farmer');
  const rate = async () => (await api(wk, 'GET', '/api/game/outposts')).body.outposts.find(x => x.id === wid);
  const base = await rate();
  r = await api(wk, 'POST', `/api/game/outposts/${wid}/assign`, { citizen_id: miner });
  check(r.status === 200 && r.body.outpost.worker && r.body.outpost.worker.fit && r.body.outpost.yields.stone === Math.round(base.yields.stone * 1.5),
    'post a Miner at a Quarry: +50% stone' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  const wid2 = await outpost(wk, 'plains');
  r = await api(wk, 'POST', `/api/game/outposts/${wid2}/assign`, { citizen_id: miner });
  check(r.status === 400 && /busy at work|already/i.test(r.body.error), 'one outpost at a time');
  const qa = await api(wk, 'GET', '/api/quests');
  const qid = qa.body.available && qa.body.available[0] && qa.body.available[0].id;
  r = await api(wk, 'POST', '/api/quests/accept', { quest_id: qid, citizen_id: miner });
  check(r.status === 400 && /outpost/.test(r.body.error), 'a posted worker can\'t go questing');
  const bd2 = await api(wk, 'GET', '/api/game/resource-breakdown');
  const opRow = ((bd2.body.breakdown || {}).stone || { sources: [] }).sources.find(x => x.kind === 'outpost' && x.outpost_id === wid);
  check(opRow && /\+50%/.test(opRow.label), 'the breakdown names the worker');
  r = await api(wk, 'POST', `/api/game/outposts/${wid2}/assign`, { citizen_id: farmer });
  check(r.status === 200 && r.body.outpost.worker && r.body.outpost.worker.fit, 'a Farmer at a Farmstead knows the land too');
  r = await api(wk, 'POST', `/api/game/outposts/${wid}/unassign`);
  check(r.status === 200 && !r.body.outpost.worker && r.body.outpost.yields.stone === base.yields.stone, 'bring them home: back to the base yield');
  check((await api(a, 'POST', `/api/game/outposts/${wid}/assign`, { citizen_id: miner })).status === 404, 'not someone else\'s outpost');

  console.log('Unfed');
  await q('UPDATE settlements SET outposts_unfed_since = NOW() WHERE id=$1', [wk.sid]);
  const hungry = await api(wk, 'GET', '/api/game/outposts');
  const h1 = hungry.body.outposts.find(x => x.id === wid);
  check(hungry.body.unfed === true && h1.yields.stone === Math.round(base.yields.stone * 0.5) && h1.notes.some(n => n.key === 'unfed'), 'unfed outposts work at half pace');
  const F = require('../famine');
  const sim = F.simulateConsumption({ foodF: 0.1, outpostCount: 2, citizens: [] }, 1, Date.now());
  const sim2 = F.simulateConsumption({ foodF: 50, outpostCount: 2, citizens: [] }, 1, Date.now());
  check(sim.outpostsUnfed === true && sim2.outpostsUnfed === false, 'the famine step knows when outposts go unfed');
  await q('UPDATE settlements SET outposts_unfed_since = NULL WHERE id=$1', [wk.sid]);

  console.log('Dismantle refund');
  const pre = await res(wk.sid);
  r = await api(wk, 'DELETE', `/api/game/outposts/${wid}`);
  const post = await res(wk.sid);
  check(r.status === 200 && r.body.refund && r.body.refund.timber === 60, 'dismantle says what came back');
  check(post.timber - pre.timber === 60 && post.stone - pre.stone === 30 && post.wealth - pre.wealth >= 15, '…and it lands in the stores');
  check((await api(wk, 'DELETE', `/api/game/outposts/${wid}`)).status === 404, 'only once');

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and TRAVEL_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
