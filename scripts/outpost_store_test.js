// ══════════════════════════════════════════════════════════════════════════
//  outpost_store_test — outposts keep what they produce; porters carry it
//  home (lib/outpost_store, routes/outposts.js /haul and the hauler post).
//
//  Part 1 is pure. Part 2 uses the database and a running server:
//
//   node scripts/outpost_store_test.js
//   DATABASE_URL=postgres://… TRAVEL_TEST_BASE=http://localhost:3999 node scripts/outpost_store_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

const OS = require('../lib/outpost_store');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  console.log('Loads and caps');
  check(OS.capOf({ level: 1 }) === 300 && OS.capOf({ level: 3 }) === 900, 'a store holds 300 of each resource per level');
  check(JSON.stringify(OS.pickLoad({ food: 10.7, timber: 3 }, 100)) === JSON.stringify({ food: 10, timber: 3 }), 'everything fits: whole units of all of it');
  const l = OS.pickLoad({ food: 100, timber: 100 }, 30);   // food 0.5 + timber 1 per unit = 150 weight
  const w = (l.food || 0) * 0.5 + (l.timber || 0);
  check(w <= 30 && w >= 29 && l.food > 0 && l.timber > 0, `too much: a fair share of each, up to the carry weight (${JSON.stringify(l)})`);
  check(OS.weightOf('wealth') === 0.1 && OS.weightOf('metal') === 2, 'coin is light; iron is heavy');
  const st = OS.present({ level: 1, store: { food: 300, timber: 12.9, nope: 5 } });
  check(st.items.food === 300 && st.items.timber === 12 && !('nope' in st.items) && st.full.includes('food') && st.cap === 300, 'what the panel sees: whole units, the cap, what is full');
  const rates = OS.ratesFor({ terrain: 'hills', level: 2, mult: 1 }, new Set());
  check(rates.stone === 10 && rates.metal === 2 && rates.copper > 0, 'an outpost\'s rate: yields and ores at its level');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.TRAVEL_TEST_BASE || process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;

  async function user(name, tier = 'village') {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, bronze, last_tick)
                        VALUES ($1,$2,2,$3,5000,5000,5000,5000,5000,0,NOW()) RETURNING *`, [u.id, username, tier])).rows[0];
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const spot = () => [-5000 - Math.floor(Math.random() * 100000), -5000 - seq++];
  async function outpost(p, terrain = 'forest', extra = {}) {
    const [tq, tr] = spot();
    return (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,$3,$4,1,$5,$6) RETURNING id`,
      [p.sid, tq, tr, terrain, JSON.stringify(extra.store || {}), extra.tick || new Date()])).rows[0].id;
  }
  const cit = async (p, name, role = 'idle') => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'female',$3,'{}','adult') RETURNING id`, [p.sid, name + RUN, role])).rows[0].id;
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const town = async sid => (await q('SELECT food, timber, stone, metal, wealth FROM settlements WHERE id=$1', [sid])).rows[0];
  const store = async id => (await q('SELECT store FROM outposts WHERE id=$1', [id])).rows[0].store || {};
  const due = id => q("UPDATE outpost_hauls SET departs_at = NOW() - interval '2 hours', arrives_at = NOW() - interval '1 hour', returns_at = NOW() - interval '1 second' WHERE id=$1", [id]);

  console.log('The store fills, the town does not');
  const a = await user('ostore');
  const tenHoursAgo = new Date(Date.now() - 10 * 3600e3);
  const o1 = await outpost(a, 'forest', { tick: tenHoursAgo });
  const t0 = await town(a.sid);
  let r = await api(a, 'GET', '/api/game/outposts');
  let me = (r.body.outposts || []).find(x => x.id === o1);
  check(me && me.store && me.store.items.timber >= 50 && me.store.items.timber <= 70, `ten hours at 6 timber an hour, seasons aside, went into its store (${me && me.store.items.timber})`);
  check(me && me.rates.timber === 6 && me.store.cap === 300 && r.body.store_per_level === 300, 'the panel gets its rate and cap');
  check(me && me.trip && me.trip.leg_seconds >= 120 && me.trip.carry === 20, `and a trip estimate: a porter carries 20 (${JSON.stringify(me && me.trip)})`);
  const s1 = await api(a, 'GET', '/api/game/settlement');
  check(s1.status === 200 && !(s1.body.settlement.rates.timber > 1000), 'GET /settlement still works');
  const t1 = await town(a.sid);
  check(Number(t1.timber) - Number(t0.timber) < 200, 'the town\'s timber did not get the outpost\'s output');

  console.log('Cap');
  const o2 = await outpost(a, 'forest', { tick: new Date(Date.now() - 200 * 3600e3), store: { timber: 290 } });
  await OS.sync((await q('SELECT * FROM settlements WHERE id=$1', [a.sid])).rows[0]);
  check(Number((await store(o2)).timber) === 300, 'production stops at the cap (300 at level 1)');

  console.log('A porter run');
  const porter = await cit(a, 'Packer');
  r = await api(a, 'POST', `/api/game/outposts/${o2}/haul`, { citizen_id: porter });
  check(r.status === 200 && r.body.haul && r.body.haul.carry === 20 && r.body.outpost.hauls.length === 1, 'send a porter: they set off' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  const hid = r.body.haul && r.body.haul.id;
  r = await api(a, 'POST', `/api/game/outposts/${o2}/haul`, { citizen_id: porter });
  check(r.status === 400 && /carrying goods/.test(r.body.error), 'not twice at once');
  const cl = await api(a, 'GET', '/api/citizens');
  const pc = (cl.body.citizens || cl.body || []).find(c => c.id === porter);
  check(pc && pc.haul && pc.haul.status === 'outbound' && pc.haul.outpost_name === 'Logging Camp', 'the citizen list shows them away, hauling');
  const qa = await api(a, 'GET', '/api/quests');
  const qid = qa.body.available && qa.body.available[0] && qa.body.available[0].id;
  if (qid) {
    r = await api(a, 'POST', '/api/quests/accept', { quest_id: qid, citizen_id: porter });
    check(r.status === 400, 'a porter on the road can\'t go questing');
  }
  await q("UPDATE outpost_hauls SET arrives_at = NOW() - interval '1 second' WHERE id=$1", [hid]);
  const s = async () => (await q('SELECT * FROM settlements WHERE id=$1', [a.sid])).rows[0];
  await OS.resolveDue(await s());
  let h = (await q('SELECT * FROM outpost_hauls WHERE id=$1', [hid])).rows[0];
  // A Logging Camp also turns up a little food: the load is a fair share of both.
  const ld = h.load || {}, wt = (ld.timber || 0) + (ld.food || 0) * 0.5;
  check(h.status === 'returning' && ld.timber > 0 && wt <= 20 && wt >= 19 && Number((await store(o2)).timber) === 300 - ld.timber, `at the outpost: a 20-weight load off the store and on their back (${JSON.stringify(ld)})`);
  const before = await town(a.sid);
  await due(hid);
  await OS.resolveDue(await s());
  h = (await q('SELECT * FROM outpost_hauls WHERE id=$1', [hid])).rows[0];
  check(h.status === 'done' && Number((await town(a.sid)).timber) - Number(before.timber) === ld.timber, 'home: the load goes into the town\'s stores');
  const led = (await q('SELECT away_ledger FROM settlements WHERE id=$1', [a.sid])).rows[0].away_ledger || {};
  check(Number(led.hauled_timber) === ld.timber, 'the away report hears about it');

  console.log('Empty store');
  const o3 = await outpost(a, 'plains');
  r = await api(a, 'POST', `/api/game/outposts/${o3}/haul`, { citizen_id: porter });
  check(r.status === 400 && /empty/.test(r.body.error), 'nothing to fetch: refused');

  console.log('A standing hauler');
  const b = await user('ohaul');
  const ob = await outpost(b, 'forest', { store: { timber: 50, food: 10 } });
  const hauler = await cit(b, 'Carter');
  r = await api(b, 'POST', `/api/game/outposts/${ob}/assign`, { citizen_id: hauler, post: 'hauler' });
  check(r.status === 200 && r.body.outpost.haulers.length === 1 && r.body.outpost.hauls.length === 1 && r.body.outpost.hauls[0].standing, 'post a hauler: they set off at once' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  const other = await cit(b, 'Second');
  r = await api(b, 'POST', `/api/game/outposts/${ob}/assign`, { citizen_id: other, post: 'hauler' });
  check(r.status === 400 && /hauler/.test(r.body.error), 'one hauler per outpost');
  const sb = async () => (await q('SELECT * FROM settlements WHERE id=$1', [b.sid])).rows[0];
  let run1 = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [hauler])).rows[0];
  await due(run1.id);
  await OS.sync(await sb());
  const runs = (await q('SELECT * FROM outpost_hauls WHERE citizen_id=$1 ORDER BY id', [hauler])).rows;
  check(runs.length >= 2 && runs[0].status === 'done' && runs[1].standing && runs[1].status === 'outbound', 'home again with a load, and straight back out while there\'s more');
  check(Date.parse(runs[1].departs_at) === Date.parse(runs[0].returns_at), '…leaving when they got home (catching up while nobody looked)');
  await q("UPDATE outpost_crew SET outpost_id = outpost_id WHERE citizen_id=$1", [hauler]);
  r = await api(b, 'POST', `/api/game/outposts/${ob}/unassign`, { citizen_id: hauler });
  run1 = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [hauler])).rows[0];
  await due(run1.id);
  await OS.sync(await sb());
  check(!(await q("SELECT 1 FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [hauler])).rows.length, 'brought home from the post: they finish the run and stay home');

  console.log('Raids loot the store');
  const R = require('../lib/raids');
  const c = await user('oraid');
  const cs = (await q('SELECT * FROM settlements WHERE id=$1', [c.sid])).rows[0];
  const [tq, tr] = spot();
  await q('UPDATE settlements SET tile_q=$2, tile_r=$3 WHERE id=$1', [c.sid, tq - 1, tr]);
  const oc = (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store) VALUES ($1,$2,$3,'plains',1,'{"food":200,"wealth":20}') RETURNING id`, [c.sid, tq, tr])).rows[0].id;
  const raid = await R.start({ ...cs, tile_q: tq - 1, tile_r: tr }, { outpostId: oc, strength: 60 });
  check(raid && raid.outpost_id === oc, 'a raid on the outpost');
  if (raid) {
    const pre = await town(c.sid);
    await q('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [raid.id]);
    await R.resolve(raid.id, () => 0.5);
    const st = await store(oc), post = await town(c.sid);
    check(Number(st.food) === 170 && Number(st.wealth) === 17, `undefended: 15% of its store taken (${JSON.stringify(st)})`);
    check(Number(pre.food) === Number(post.food) && Number(pre.wealth) === Number(post.wealth), '…and nothing from the town');
  }

  console.log('Dismantling');
  const d = await user('odis');
  const od = await outpost(d, 'forest', { store: { timber: 77.6, copper: 3 } });
  const pre = await town(d.sid);
  r = await api(d, 'DELETE', `/api/game/outposts/${od}`);
  check(r.status === 200 && r.body.carried && r.body.carried.timber === 77 && r.body.carried.copper === 3, 'dismantle: the crew carry the store home');
  check(Number((await town(d.sid)).timber) - Number(pre.timber) === 77 + 60, '…on top of the refund');

  console.log('Buildings');
  const e = await user('obuild');
  const oe = await outpost(e, 'forest');
  const ready = key => q("UPDATE outpost_buildings SET ready_at = NOW() - interval '1 second' WHERE outpost_id=$1 AND key=$2", [oe, key]);
  const view = async (p = e, id = oe) => (await api(p, 'GET', '/api/game/outposts')).body.outposts.find(x => x.id === id);
  let ve = await view();
  check(ve.buildings && ve.buildings.slots === 2 && ve.buildings.used === 0, 'a level 1 outpost has 2 building plots');
  const keys = ve.buildings.options.map(x => x.key);
  check(keys.includes('sawpit') && keys.includes('storehouse') && !keys.includes('granary') && !keys.includes('smokehouse'), 'forest land offers a Sawpit, not a Granary');
  r = await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'granary' });
  check(r.status === 400 && /doesn't belong/.test(r.body.error), 'a Granary in a forest: refused');
  const pre1 = await town(e.sid);
  r = await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'storehouse' });
  check(r.status === 200 && Number(pre1.timber) - Number((await town(e.sid)).timber) === 120 && r.body.outpost.buildings.built[0].ready === false,
    'raise a Storehouse: paid from the town, going up' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  check(r.body.outpost.store.cap === 300, '…no effect until it is finished');
  await ready('storehouse');
  ve = await view();
  check(ve.store.cap === 450, 'finished: half as much room again (450)');
  r = await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'sawpit' });
  await ready('sawpit');
  ve = await view();
  check(r.status === 200 && ve.rates.timber === 7.5, `a Sawpit: +25% timber (${ve.rates.timber})`);
  r = await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'mule_pen' });
  check(r.status === 400 && /2 building plots/.test(r.body.error), 'plots full: refused');
  r = await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'storehouse' });
  check(r.status === 400, 'one of each');
  r = await api(e, 'DELETE', `/api/game/outposts/${oe}/buildings/storehouse`);
  check(r.status === 200 && r.body.outpost.buildings.used === 1 && r.body.outpost.store.cap === 300, 'pull one down: the plot is free, the room is gone');
  const t0e = (await view()).trip;
  await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'waystation' });
  await ready('waystation');
  const t1e = (await view()).trip;
  check(t1e.leg_seconds === Math.round(t0e.leg_seconds * 0.7) && t1e.carry === t0e.carry, `a Waystation: trips 30% faster (${t0e.leg_seconds}s → ${t1e.leg_seconds}s)`);
  await api(e, 'DELETE', `/api/game/outposts/${oe}/buildings/waystation`);
  await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'mule_pen' });
  await ready('mule_pen');
  check((await view()).trip.carry === Math.floor(t0e.carry * 1.5), 'a Mule Pen: porters carry half as much again');
  await api(e, 'DELETE', `/api/game/outposts/${oe}/buildings/mule_pen`);
  await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'bunkhouse' });
  await ready('bunkhouse');
  check((await view()).worker_slots === 2, 'a Bunkhouse: room for one more worker');
  await api(e, 'DELETE', `/api/game/outposts/${oe}/buildings/bunkhouse`);
  await api(e, 'POST', `/api/game/outposts/${oe}/buildings`, { key: 'watchfire' });
  await ready('watchfire');
  check((await view()).defence.own === 8, 'a Watchfire: +8 defence');

  console.log('Walking to and from a post');
  const f = await user('owalk');
  const [fq, fr] = spot();
  await q('UPDATE settlements SET tile_q=$2, tile_r=$3 WHERE id=$1', [f.sid, fq - 2, fr]);
  const of = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,$3,'forest',1) RETURNING id", [f.sid, fq, fr])).rows[0].id;
  const walker = await cit(f, 'Strider', 'woodcutter');
  r = await api(f, 'POST', `/api/game/outposts/${of}/assign`, { citizen_id: walker });
  const walk = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [walker])).rows[0];
  check(r.status === 200 && walk && walk.kind === 'post' && r.body.outpost.workers[0].arriving, 'posted: they walk out (a "post" walk), not working yet');
  const cl2 = await api(f, 'GET', '/api/citizens');
  const wc = (cl2.body.citizens || cl2.body || []).find(c => c.id === walker);
  check(wc && wc.haul && wc.haul.kind === 'post' && wc.outpost, 'the citizen list shows them on the road to their post');
  const trv = await api(f, 'GET', '/api/travel');
  const jw = (trv.body.journeys || []).find(j => j.id === 'outpost:' + walk.id);
  check(jw && jw.kind === 'outpost' && jw.to.q === fq && jw.returns_at === null && /Walking out/.test(jw.title), 'the map draws the walk (town → outpost)');
  await q("UPDATE outpost_hauls SET arrives_at = NOW() - interval '1 second', returns_at = NOW() - interval '1 second' WHERE id=$1", [walk.id]);
  await q('UPDATE outpost_crew SET arrives_at = NOW() - interval \'1 second\' WHERE citizen_id=$1', [walker]);
  const sf = async () => (await q('SELECT * FROM settlements WHERE id=$1', [f.sid])).rows[0];
  await OS.sync(await sf());
  check((await q('SELECT status FROM outpost_hauls WHERE id=$1', [walk.id])).rows[0].status === 'done', 'arrived: the walk is over');
  r = await api(f, 'POST', `/api/game/outposts/${of}/unassign`, { citizen_id: walker });
  const back = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [walker])).rows[0];
  check(r.status === 200 && back && back.kind === 'return' && back.status === 'returning', 'brought home: they walk back (a "return" walk)');
  const tr2 = await api(f, 'GET', '/api/travel');
  const jb = (tr2.body.journeys || []).find(j => j.id === 'outpost:' + back.id);
  check(jb && jb.from.q === fq && /Walking home/.test(jb.title), 'the map draws the walk home (outpost → town)');
  const qa2 = await api(f, 'GET', '/api/quests');
  const qid2 = qa2.body.available && qa2.body.available[0] && qa2.body.available[0].id;
  if (qid2) {
    r = await api(f, 'POST', '/api/quests/accept', { quest_id: qid2, citizen_id: walker });
    check(r.status === 400, 'busy until they are home');
  }
  await q("UPDATE outpost_hauls SET returns_at = NOW() - interval '1 second' WHERE id=$1", [back.id]);
  await OS.sync(await sf());
  check((await q('SELECT status FROM outpost_hauls WHERE id=$1', [back.id])).rows[0].status === 'done', 'home: free again');
  // Called back while still on the way out: they turn round where they are.
  r = await api(f, 'POST', `/api/game/outposts/${of}/assign`, { citizen_id: walker });
  r = await api(f, 'POST', `/api/game/outposts/${of}/unassign`, { citizen_id: walker });
  const turn = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [walker])).rows[0];
  check(turn && turn.kind === 'return' && (new Date(turn.returns_at) - new Date(turn.departs_at)) < 10000, 'called back just after setting out: home in moments');

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
