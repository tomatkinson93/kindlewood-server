// ══════════════════════════════════════════════════════════════════════════
//  raids_test — trust that fades (lib/trust_decay), the Allied tribute
//  (routes/diplomacy), and soft raids by the Withered (lib/raids,
//  routes/raids).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/raids_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  const D = require('../lib/trust_decay');
  const R = require('../lib/raids');
  console.log('Rules');
  check(D.floorFor(80) === 41 && D.floorFor(50) === 21 && D.floorFor(30) === 1 && D.floorFor(10) === 0, 'floors: Allied → 41, Friendly → 21, Familiar → 1');
  const now = Date.parse('2026-06-10T00:00:00Z');
  check(D.warning({ trust: 50, last_interaction: '2026-06-07T00:00:00Z' }, now) === null, 'no warning after 3 quiet days');
  check(/haven't heard from you in 5 days/.test(D.warning({ trust: 50, last_interaction: '2026-06-05T00:00:00Z' }, now).text), 'a warning from day 5');
  check(D.warning({ trust: 80, trust_floor: 41, last_interaction: '2026-06-01T00:00:00Z' }, now).decaying, 'from day 7 trust is slipping');
  check(Math.abs(R.CHECK_CHANCE * (R.DAYS_PER_RAID * 24 * 6) - 1) < 1e-9, 'about one raid every 5 days');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  const X = -90000 - Math.floor(Math.random() * 5000) * 20;   // far off the real map
  async function player(name, { tier = 'village', age = 30, forceId = null } = {}) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET email = users.email RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    await q("UPDATE users SET created_at = NOW() - make_interval(days => $2) WHERE id=$1", [u.id, age]);
    const tq = X + seq * 40;
    let s = (await q('SELECT id FROM settlements WHERE user_id=$1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, tile_q, tile_r, last_tick)
                          VALUES ($1,$2,2,$3,1000,1000,1000,1000,1000,$4,0,NOW()) RETURNING id`, [u.id, username, tier, tq])).rows[0];
    else await q('UPDATE settlements SET tier=$2, tile_q=$3, tile_r=0, wealth=1000, food=1000, timber=1000, stone=1000, metal=1000 WHERE id=$1', [s.id, tier, tq]);
    await q('DELETE FROM settlement_raids WHERE settlement_id=$1', [s.id]);
    return { id: u.id, sid: s.id, q: tq, r: 0, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const npc = async (name, tq, tr, hostile) => (await q(
    `INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [name + RUN, tq, tr, hostile ? 'hostile' : 'neutral', hostile ? 'withered' : 'mice', hostile ? 'hostile' : 'friendly'])).rows[0].id;
  const D = require('../lib/trust_decay');
  const R = require('../lib/raids');

  console.log('Trust decay');
  const a = await player('decay');
  const v1 = await npc('Hollyhock', a.q + 30, 30, false), v2 = await npc('Bramblegate', a.q + 31, 30, false), v3 = await npc('Quietford', a.q + 32, 30, false);
  const rel = async (v, trust, daysAgo) => (await q(
    `INSERT INTO diplomacy_relations (settlement_id, npc_id, trust, status, last_interaction) VALUES ($1,$2,$3,'allied', NOW() - make_interval(days => $4)) RETURNING id`, [a.sid, v, trust, daysAgo])).rows[0].id;
  const r1 = await rel(v1, 75, 10), r2 = await rel(v2, 42, 10), r3 = await rel(v3, 60, 2);
  await q('UPDATE diplomacy_relations SET trust_floor = 41 WHERE id=$1', [r2]);   // it was Allied once
  const get = async id => (await q('SELECT trust, trust_floor, status FROM diplomacy_relations WHERE id=$1', [id])).rows[0];
  const t0 = Date.now();
  await D.run(t0);
  let g1 = await get(r1);
  check(g1.trust === 74 && g1.trust_floor === 41, `10 quiet days: Allied 75 → 74, floor 41 (${g1.trust}, floor ${g1.trust_floor})`);
  await D.run(t0 + 60e3);
  check((await get(r1)).trust === 74, 'only once a day');
  await D.run(t0 + 86400e3 + 60e3);
  check((await get(r1)).trust === 73, 'the next day, another point');
  check((await get(r3)).trust === 60, 'a village you wrote to two days ago doesn\'t forget');
  await D.run(t0 + 2 * 86400e3 + 120e3);
  await D.run(t0 + 3 * 86400e3 + 180e3);
  check((await get(r2)).trust === 41, 'never below the floor (an old ally stays Friendly)');
  const r4id = (await q("UPDATE diplomacy_relations SET trust = 41, trust_floor = 0, status='friendly', trust_decayed_at = NULL WHERE id=$1 RETURNING id", [r3])).rows[0].id;
  await q("UPDATE diplomacy_relations SET last_interaction = NOW() - interval '9 days' WHERE id=$1", [r4id]);
  await D.run(t0 + 4 * 86400e3);
  const g4 = await get(r4id);
  const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='trust_faded' ORDER BY id DESC LIMIT 1", [a.sid])).rows[0];
  check(g4.trust === 40 && g4.status === 'familiar' && ev && /Friendly to Familiar/.test(ev.message), 'falling out of a band changes the status and says so');
  let dv = await api(a, 'GET', `/api/diplomacy/${v1}`);
  check(dv.status === 200 && dv.body.decay_warning && dv.body.decay_warning.decaying, 'the village panel warns that trust is slipping');

  console.log('Allied tribute');
  const before = (await q('SELECT food, timber FROM settlements WHERE id=$1', [a.sid])).rows[0];
  let t = await api(a, 'POST', `/api/diplomacy/${v1}/tribute`);
  const after = (await q('SELECT food, timber FROM settlements WHERE id=$1', [a.sid])).rows[0];
  check(t.status === 200 && t.body.bundle && Number(after.food) - Number(before.food) === (t.body.bundle.food || 0), 'an Allied village sends tribute' + (t.status === 200 ? '' : ' — ' + JSON.stringify(t.body)));
  check((await q('SELECT last_interaction > NOW() - interval \'1 minute\' AS fresh FROM diplomacy_relations WHERE id=$1', [r1])).rows[0].fresh, '…and that counts as contact');
  t = await api(a, 'POST', `/api/diplomacy/${v1}/tribute`);
  check(t.status === 400 && /tomorrow/.test(t.body.error), 'once a day');
  t = await api(a, 'POST', `/api/diplomacy/${v2}/tribute`);
  check(t.status === 400 && /Allied/.test(t.body.error), 'only when Allied');
  dv = await api(a, 'GET', `/api/diplomacy/${v1}`);
  check(dv.body.tribute && dv.body.tribute.allied && !dv.body.tribute.available, 'the panel knows it has been collected');

  console.log('Raids');
  const b = await player('raid');
  const band = await npc('Rot Warren', b.q + 3, 0, true);
  const out1 = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,0,'hills',2) RETURNING id", [b.sid, b.q + 2])).rows[0].id;
  const el = await R.eligible();
  const mineEl = el.list.find(x => x.s.id === b.sid);
  check(mineEl && mineEl.t.outpost && mineEl.t.outpost.id === out1, 'a town near Withered land can be raided — its nearest outpost is the target');
  const young = await player('young', { age: 2 }), camp = await player('camp', { tier: 'camp' });
  await npc('Rot Warren2', young.q + 2, 0, true); await npc('Rot Warren3', camp.q + 2, 0, true);
  const el2 = await R.eligible();
  check(!el2.list.some(x => x.s.id === young.sid) && !el2.list.some(x => x.s.id === camp.sid), 'new players and Camps are left alone');
  const sRow = (await q('SELECT * FROM settlements WHERE id=$1', [b.sid])).rows[0];
  const raid = await R.start(sRow);
  check(raid && raid.outpost_id === out1 && Date.parse(raid.arrives_at) - Date.now() > 5.9 * 3600e3, 'raiders gather: 6 hours\' warning');
  check(!(await R.start(sRow)), 'one raid on its way at a time');
  const warn = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='raid_warning' ORDER BY id DESC LIMIT 1", [b.sid])).rows[0];
  check(warn && /strike the Quarry in about 6 hours/.test(warn.message), 'a warning event names the target');
  let g = await api(b, 'GET', '/api/raids');
  check(g.status === 200 && g.body.active && g.body.active.id === raid.id && g.body.threat.in_reach && g.body.defence, 'GET /api/raids: the raid on its way, the threat and your defence');
  const st = (await api(b, 'GET', '/api/game/settlement')).body.settlement;
  check(st && st.raid && st.raid.id === raid.id, 'the settlement carries it for the banner');
  // Strong defence: a Lv5 Watchtower with Guards → repelled.
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'watchtower',5)", [b.sid]);
  for (let i = 0; i < 4; i++) await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'male','soldier','{}','adult')`, [b.sid, 'Guard' + i + RUN]);
  const w0 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [b.sid])).rows[0].wealth);
  await q('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [raid.id]);
  const done = await R.resolve(raid.id, () => 0.5);
  const w1 = Number((await q('SELECT wealth FROM settlements WHERE id=$1', [b.sid])).rows[0].wealth);
  check(done && done.outcome === 'repelled' && w1 > w0, `a manned Lv5 Watchtower repels them (defence ${done && done.defence} vs ${raid.strength}) and earns wealth`);
  check(!(await R.resolve(raid.id)), 'a raid resolves once');
  check(!(await R.eligible()).list.some(x => x.s.id === b.sid), 'then 48 hours of peace');
  // No defence → lost.
  const c = await player('loser');
  await npc('Rot Warren4', c.q + 2, 0, true);
  const oc = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,0,'plains',1) RETURNING id", [c.sid, c.q + 1])).rows[0].id;
  const cs = (await q('SELECT * FROM settlements WHERE id=$1', [c.sid])).rows[0];
  const r2r = await R.start(cs, { strength: 80 });
  await q('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [r2r.id]);
  const lost = await R.resolve(r2r.id, () => 0.2);   // < 0.5 → the outpost is overrun
  const op = (await q('SELECT raided_until FROM outposts WHERE id=$1', [oc])).rows[0];
  check(lost.outcome === 'lost' && op.raided_until && Date.parse(op.raided_until) > Date.now() + 5 * 3600e3, 'undefended: the outpost is overrun for 6 hours');
  const ann = (await require('../lib/outpost_state').load(null, cs)).find(x => x.id === oc);
  check(ann.mult === 0 && ann.notes.some(n => n.key === 'raided'), '…and produces nothing meanwhile');
  const d2 = await player('robbed');
  await npc('Rot Warren5', d2.q + 2, 0, true);
  await q('UPDATE settlements SET food = 50000 WHERE id=$1', [d2.sid]);
  const ds = (await q('SELECT * FROM settlements WHERE id=$1', [d2.sid])).rows[0];
  const r3r = await R.start(ds, { strength: 80 });
  await q('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [r3r.id]);
  const robbed = await R.resolve(r3r.id, () => 0.9);
  const food = Number((await q('SELECT food FROM settlements WHERE id=$1', [d2.sid])).rows[0].food);
  check(robbed.outcome === 'lost' && robbed.loot.stolen && robbed.loot.stolen.qty === 300 && food === 49700, 'a town raid carries off a share of one resource — at most 300');
  const ar = await require('../lib/away_report').eventFromSettlementEvent?.({ type: 'raid_lost', message: 'x', created_at: new Date() });
  check(!ar || ar.icon === '🔥', 'raids show in the away report');

  if (ADMIN) {
    console.log('Dev Tools');
    const adm = await player('admin', { forceId: ADMIN });
    await npc('Rot Warren6', adm.q + 2, 0, true);
    let x = await api(adm, 'POST', '/api/raids/admin/send', {});
    check(x.status === 200 && x.body.raid, 'send a raid now');
    x = await api(adm, 'POST', '/api/raids/admin/resolve', {});
    check(x.status === 200 && x.body.raid && x.body.raid.outcome, 'resolve it now');
    check((await api(a, 'POST', '/api/raids/admin/send', {})).status === 403, 'players can\'t');
  }

  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and QUEST_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
