// ══════════════════════════════════════════════════════════════════════════
//  outpost_r6c_test — haul filters and thresholds, roads, outpost events,
//  clan features (land store, Outpost Network boon, haul goal, Signal Tower,
//  a clanmate's porter) and the outpost Dev Tools.
//
//   DATABASE_URL=postgres://… TRAVEL_TEST_BASE=http://localhost:3999 \
//   CRAFTING_TEST_ADMIN_ID=990001 node scripts/outpost_r6c_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  const OS = require('../lib/outpost_store');
  const R = require('../lib/outpost_roads');
  console.log('Pure');
  check(JSON.stringify(OS.pickLoad({ food: 50, timber: 50 }, 100, ['timber'])) === JSON.stringify({ timber: 50 }), 'a filter: porters carry only what it names');
  check(R.tripMult({ road_level: 1 }) === 0.75 && R.tripMult({ road_level: 2 }) === 0.5 && R.tripMult({ road_level: 0 }) === 1, 'a track: 25% faster; paved: 50%');
  check(R.levelOf({ road_level: 2, road_ready_at: new Date(Date.now() + 3600e3) }) === 1, 'a road still being laid counts as the level below');
  const n = R.nextOf({ road_level: 0 }, 3);
  check(n.level === 1 && n.cost.timber === 180 && n.cost.stone === 60 && n.hours === 1.5, 'a track costs by the tiles it crosses');
  check(OS.capOf({ level: 1, on_clan_land: true }) === 375, 'on clan land the store is a quarter bigger');
  const E = require('../lib/outpost_events');
  // Wolves default to "drive them off" since Phase 2: the default is never the worst option.
  check(Object.keys(E.KINDS).length >= 7 && E.KINDS.wolves.fallback === 'fight' && E.EXPIRE_H === 12, 'seven kinds of event; each has a fallback after 12 hours');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const OS = require('../lib/outpost_store');
  const E = require('../lib/outpost_events');
  const BASE = process.env.TRAVEL_TEST_BASE || process.env.CRAFTING_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.CRAFTING_TEST_ADMIN_ID || 0);
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  async function user(name, id = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = id
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username RETURNING id", [id, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT * FROM settlements WHERE user_id=$1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, last_tick, tile_q, tile_r)
                        VALUES ($1,$2,2,'village',5000,5000,5000,5000,5000,NOW(),$3,$4) RETURNING *`, [u.id, username, -40000 - seq * 20, -40000 - Math.floor(Math.random() * 900000)])).rows[0];   // a fresh row each run
    else await q('UPDATE settlements SET wealth=5000, food=5000, timber=5000, stone=5000, metal=5000 WHERE id=$1', [s.id]);
    return { id: u.id, sid: s.id, q: s.tile_q, r: s.tile_r, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function outpost(p, terrain, dq = 2, extra = {}) {
    return (await q(`INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, store, store_tick) VALUES ($1,$2,$3,$4,1,$5,NOW()) RETURNING id`,
      [p.sid, p.q + dq, p.r + (extra.dr || 0), terrain, JSON.stringify(extra.store || {})])).rows[0].id;
  }
  const cit = async (p, name, role = 'idle') => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'female',$3,'{}','adult') RETURNING id`, [p.sid, name + RUN, role])).rows[0].id;
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const view = async (p, id) => (await api(p, 'GET', '/api/game/outposts')).body.outposts.find(x => x.id === id);
  const srow = async p => (await q('SELECT * FROM settlements WHERE id=$1', [p.sid])).rows[0];
  const store = async id => (await q('SELECT store FROM outposts WHERE id=$1', [id])).rows[0].store || {};
  let r;

  console.log('Haul filters and thresholds');
  const a = await user('r6filt');
  const oa = await outpost(a, 'forest', 2, { store: { timber: 100, food: 100 } });
  r = await api(a, 'PATCH', `/api/game/outposts/${oa}/settings`, { haul_filter: ['food'], haul_threshold: 50 });
  check(r.status === 200 && JSON.stringify(r.body.outpost.settings.haul_filter) === '["food"]' && r.body.outpost.settings.haul_threshold === 50, 'save: carry food only; hauler waits for half full');
  check((await api(a, 'PATCH', `/api/game/outposts/${oa}/settings`, { haul_threshold: 33 })).status === 400, 'only 0, 25, 50, 75 or 90 %');
  const porter = await cit(a, 'Pack');
  r = await api(a, 'POST', `/api/game/outposts/${oa}/haul`, { citizen_id: porter });
  const h = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [porter])).rows[0];
  await q("UPDATE outpost_hauls SET arrives_at = NOW() - interval '1 second' WHERE id=$1", [h.id]);
  await OS.resolveDue(await srow(a));
  const ld = (await q('SELECT load FROM outpost_hauls WHERE id=$1', [h.id])).rows[0].load;
  check(ld && ld.food > 0 && !ld.timber, `the porter brought only food (${JSON.stringify(ld)})`);
  const hauler = await cit(a, 'Steady');
  r = await api(a, 'POST', `/api/game/outposts/${oa}/assign`, { citizen_id: hauler, post: 'hauler' });
  check(r.status === 200 && !(await q("SELECT 1 FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [hauler])).rows.length, 'the hauler waits: food is under half the store');
  await q(`UPDATE outposts SET store = store || '{"food": 200}'::jsonb WHERE id=$1`, [oa]);
  await OS.sync(await srow(a));
  check((await q("SELECT 1 FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [hauler])).rows.length === 1, 'past half full: the hauler sets out');
  await api(a, 'PATCH', `/api/game/outposts/${oa}/settings`, { haul_filter: ['metal'] });
  const p2 = await cit(a, 'Idle');
  r = await api(a, 'POST', `/api/game/outposts/${oa}/haul`, { citizen_id: p2 });
  check(r.status === 400 && /set to carry/.test(r.body.error), 'nothing it is set to carry: no porter');

  console.log('Roads');
  const b = await user('r6road');
  const ob = await outpost(b, 'forest', 3);
  let vb = await view(b, ob);
  check(vb.road && vb.road.level === 0 && vb.road.next && vb.road.next.level === 1 && vb.road.tiles === 3, 'no road yet; a track is offered over 3 tiles');
  const t0 = vb.trip.leg_seconds;
  const w0 = Number((await srow(b)).timber);
  r = await api(b, 'POST', `/api/game/outposts/${ob}/road`);
  check(r.status === 200 && w0 - Number((await srow(b)).timber) === vb.road.next.cost.timber && r.body.outpost.road.building, 'lay a track: paid, the crew at work');
  check((await api(b, 'POST', `/api/game/outposts/${ob}/road`)).status === 400, 'one stretch at a time');
  await q('UPDATE outposts SET road_ready_at = NOW() WHERE id=$1', [ob]);
  vb = await view(b, ob);
  check(vb.road.level === 1 && vb.trip.leg_seconds === Math.round(t0 * 0.75), `finished: trips 25% faster (${t0}s → ${vb.trip.leg_seconds}s)`);
  const tiles = (await api(b, 'GET', '/api/map/world')).body;
  const tile = tiles && (tiles.tiles || []).find(t => t.outpost && t.outpost.id === ob);
  if (tile) check(tile.outpost.road === 1, 'the map knows the road');

  console.log('Events');
  const c = await user('r6evt');
  const oc = await outpost(c, 'forest', 2, { store: { timber: 100, food: 100 } });
  const cs = await srow(c);
  const ocRow = (await q('SELECT * FROM outposts WHERE id=$1', [oc])).rows[0];
  let ev = await E.start(ocRow, cs, 'storm');
  let vc = await view(c, oc);
  check(vc.events.length === 1 && vc.events[0].kind === 'storm' && vc.events[0].options.length === 2, 'an event shows on the outpost with its choices');
  const tb = Number(cs.timber);
  r = await api(c, 'POST', `/api/game/outposts/${oc}/events/${ev.id}`, { choice: 'shore' });
  check(r.status === 200 && /stayed dry/.test(r.body.outcome) && tb - Number((await srow(c)).timber) === 40, 'shore up: 40 timber, nothing lost');
  check((await api(c, 'POST', `/api/game/outposts/${oc}/events/${ev.id}`, { choice: 'ride' })).status === 404, 'only answered once');
  ev = await E.start(ocRow, cs, 'wolves');
  r = await api(c, 'POST', `/api/game/outposts/${oc}/events/${ev.id}`, { choice: 'fight' });
  check(r.status === 200 && /Too few/.test(r.body.outcome) && Number((await store(oc)).food) === 90, 'no defence: the wolves win and scatter 10%');
  ev = await E.start(ocRow, cs, 'trader');
  const sell = ev && ev.options.find(o => o.key === 'sell');
  r = await api(c, 'POST', `/api/game/outposts/${oc}/events/${ev.id}`, { choice: 'sell' });
  check(sell && r.status === 200 && Number((await store(oc)).wealth) > 0, 'sell to the trader: wealth into the store');
  ev = await E.start(ocRow, cs, 'traveller', () => 0.1);   // they'll stay
  const before = (await q('SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id=$1', [c.sid])).rows[0].n;
  r = await api(c, 'POST', `/api/game/outposts/${oc}/events/${ev.id}`, { choice: 'shelter' });
  check(r.status === 200 && r.body.joined && (await q('SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id=$1', [c.sid])).rows[0].n === before + 1, 'shelter a traveller: they join the town');
  ev = await E.start(ocRow, cs, 'storm');
  // Outpost events are moments now (lib/moments.js).
  await q("UPDATE moments SET expires_at = NOW() - interval '1 second' WHERE id=$1", [ev.id]);
  const out = await E.choose(c.sid, ev.id, 'ride', true);
  const row = (await q('SELECT * FROM moments WHERE id=$1', [ev.id])).rows[0];
  check(out.ok && row.resolved_at && row.choice === 'ride', 'no answer in time: the fallback happens');
  await q("UPDATE outposts SET store = '{}'::jsonb WHERE id = $1", [oc]);
  check(!(await E.start(ocRow, cs, 'trader')), 'a trader only comes when there is something to buy');

  console.log('Clans');
  const m1 = await user('r6clanA'), m2 = await user('r6clanB'), out1 = await user('r6loner');
  const clan = (await q("INSERT INTO clans (name, founder_user_id) VALUES ($1,$2) RETURNING id", ['Haul' + RUN, m1.id])).rows[0].id;
  await q("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'founder'),($3,$2,'member')", [m1.id, clan, m2.id]);
  const om = await outpost(m1, 'forest', 2, { store: { timber: 120 } });
  await q('INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [m1.q + 2, m1.r, clan, m1.id]);
  const vm = await view(m1, om);
  check(vm.on_clan_land && vm.store.cap === 375 && vm.buildings.options.some(x => x.key === 'signal_tower'), 'on clan land: a bigger store, and a Signal Tower can be built');
  const ol = await outpost(out1, 'forest', 2);
  check(!(await view(out1, ol)).buildings.options.some(x => x.key === 'signal_tower'), 'off clan land: no Signal Tower');
  const helper = await cit(m2, 'Helper');
  r = await api(m2, 'POST', `/api/game/outposts/${om}/help`, { citizen_id: helper });
  check(r.status === 200 && r.body.haul && r.body.haul.carry > 0, 'a clanmate sends a porter to help' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  const lonerCit = await cit(out1, 'Nosy');
  check((await api(out1, 'POST', `/api/game/outposts/${om}/help`, { citizen_id: lonerCit })).status === 403, 'not a clanmate: refused');
  const hh = (await q("SELECT * FROM outpost_hauls WHERE citizen_id=$1 AND status <> 'done'", [helper])).rows[0];
  check(hh.settlement_id === m2.sid && hh.owner_settlement_id === m1.sid, 'the run is the helper\'s; the goods are the owner\'s');
  await q("UPDATE outpost_hauls SET arrives_at = NOW() - interval '2 seconds', returns_at = NOW() - interval '1 second' WHERE id=$1", [hh.id]);
  const owner0 = Number((await srow(m1)).timber), helper0 = Number((await srow(m2)).timber);
  await OS.resolveDue(await srow(m2));
  await OS.resolveDue(await srow(m2));
  const got = Number((await srow(m1)).timber) - owner0;
  check(got > 0 && Number((await srow(m2)).timber) === helper0, `delivered to the owner (+${got} timber), not the helper`);
  check((await q("SELECT 1 FROM settlement_events WHERE settlement_id=$1 AND type='clan_haul'", [m1.sid])).rows.length === 1, 'the owner hears who helped');
  const since = new Date(Date.now() - 3600e3);
  const prog = Number((await q(`SELECT COALESCE(SUM(v.value::numeric),0)::int AS n FROM outpost_hauls h, jsonb_each_text(COALESCE(h.load,'{}'::jsonb)) v
                                 WHERE COALESCE(h.owner_settlement_id, h.settlement_id) = $1 AND h.kind='haul' AND h.status='done' AND h.returns_at >= $2`, [m1.sid, since])).rows[0].n);
  check(prog === got, 'the clan "carry goods" goal counts it');
  // The Outpost Network boon: porters carry 25% more.
  const t1 = (await view(m1, om)).trip.carry;
  await q("INSERT INTO clan_boons (clan_id, boon_key, until) VALUES ($1, 'outpost_network', NOW() + interval '1 day')", [clan]).catch(async () => {
    await q("INSERT INTO clan_boons (clan_id, boon_key, expires_at) VALUES ($1, 'outpost_network', NOW() + interval '1 day')", [clan]);
  });
  const t2 = (await view(m1, om)).trip.carry;
  check(t2 === Math.floor(t1 * 1.25), `Outpost Network boon: +25% carried (${t1} → ${t2})`);
  // Signal Tower: m2's fortified outpost shares twice as much, from further.
  const D = require('../lib/defences');
  const o2 = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, fort_level) VALUES ($1,$2,$3,'forest',1,1) RETURNING id", [m2.sid, m1.q + 6, m1.r])).rows[0].id;
  await q('INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [m1.q + 6, m1.r, clan, m2.id]);
  await q('UPDATE outposts SET fort_level = 1 WHERE id=$1', [om]);
  const far = await D.clanShare(await srow(m1), m1.q + 2, m1.r, 100);
  await q("INSERT INTO outpost_buildings (outpost_id, key, ready_at) VALUES ($1, 'signal_tower', NOW())", [o2]);
  const near = await D.clanShare(await srow(m1), m1.q + 2, m1.r, 100);
  check(far.value === 0 && near.value === Math.round(10 * D.CLAN_SHARE * 2), `Signal Tower: a clanmate 4 tiles off now shares, twice over (${far.value} → ${near.value})`);

  console.log('Dev Tools');
  if (ADMIN) {
    const ad = await user('r6admin', ADMIN);
    await q('DELETE FROM outposts WHERE settlement_id=$1', [ad.sid]);   // the admin's town is reused between runs
    const oad = await outpost(ad, 'plains', 2);
    await q("INSERT INTO outpost_buildings (outpost_id, key, ready_at) VALUES ($1, 'granary', NOW() + interval '2 hours') ON CONFLICT DO NOTHING", [oad]);
    r = await api(ad, 'POST', '/api/game/outposts/admin/finish');
    check(r.status === 200 && (await q('SELECT ready_at <= NOW() AS ok FROM outpost_buildings WHERE outpost_id=$1 AND key=$2', [oad, 'granary'])).rows[0].ok, 'finish: buildings ready now');
    r = await api(ad, 'POST', '/api/game/outposts/admin/fill');
    check(r.status === 200 && Number((await store(oad)).food) === 300, 'fill: every store full');
    r = await api(ad, 'POST', '/api/game/outposts/admin/event', { outpost_id: oad, kind: 'harvest' });
    check(r.status === 200 && /bumper crop/.test(r.body.message), 'event: start one now');
    r = await api(ad, 'POST', '/api/game/outposts/admin/events-clear');
    check(r.status === 200 && /1 event/.test(r.body.message), 'clear events');
    check((await api(a, 'POST', '/api/game/outposts/admin/fill')).status === 403, 'players can\'t use them');
  } else console.log('  (skipped — set CRAFTING_TEST_ADMIN_ID)');

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
