// ══════════════════════════════════════════════════════════════════════════
//  defences_test — Walls, outpost forts and crews (lib/defences,
//  routes/outposts, routes/buildings), clan-shared defence, graded raids
//  with injuries, tribute, scouted strength (lib/raids, routes/raids).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/defences_test.js
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg); }
}

function part1() {
  const D = require('../lib/defences');
  const R = require('../lib/raids');
  const RS = require('../lib/research_defs');
  console.log('Rules');
  check(D.FORT[1].defence === 10 && D.FORT[3].slots === 3 && D.WALLS_PER_LEVEL === 15, 'forts 10/25/45 with 1–3 posts; walls 15 a level');
  check(D.fortAllowed(RS.effectsOf(['palisades'])) === 1 && D.fortAllowed(RS.effectsOf(['palisades', 'signal_fires', 'stone_forts', 'drill_yards', 'bastions'])) === 3, 'research raises the fort you may build');
  const s = { tier: 'village', raid_tribute_at: null, raid_tribute_streak: 0 };
  check(R.tributeQuote(s, null).cost === 400 && R.tributeQuote(s, { id: 1 }).cost === 800, 'tribute: 200 × (tier + 1); double to turn a raid back');
  check(R.tributeQuote({ ...s, raid_tribute_at: new Date().toISOString(), raid_tribute_streak: 2 }, null).cost === 900, 'each tribute within three days costs 50% more');
  const v = R.view({ id: 1, strength: 100, resolved_at: null }, 0.2);
  check(v.strength === null && v.strength_min === 80 && v.strength_max === 120, 'before it strikes, only a range of its strength is shown');
}

async function part2() {
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;
  const X = -40000 - Math.floor(Math.random() * 5000) * 20;
  async function player(name) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    await q("UPDATE users SET created_at = NOW() - interval '30 days' WHERE id=$1", [u.id]);
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, wealth, food, timber, stone, metal, bronze, tile_q, tile_r, last_tick)
                        VALUES ($1,$2,2,'town',20000,20000,20000,20000,20000,200,$3,0,NOW()) RETURNING id`, [u.id, username, X + seq * 40])).rows[0];
    return { id: u.id, sid: s.id, q: X + seq * 40, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  const api = async (p, method, pth, body) => {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const cit = async (p, name, role) => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, skills, life_stage) VALUES ($1,$2,'male',$3,'{}','adult') RETURNING id`, [p.sid, name + RUN, role])).rows[0].id;
  const study = async (p, ...keys) => { for (const k of keys) await require('../lib/research').adminComplete(p.sid, k).catch(e => console.log('    study', k, e.message)); };
  const sRow = async p => (await q('SELECT * FROM settlements WHERE id=$1', [p.sid])).rows[0];
  const D = require('../lib/defences');
  const R = require('../lib/raids');

  console.log('Walls');
  const a = await player('walls');
  let r = await api(a, 'POST', '/api/buildings/build', { buildingId: 'walls' });
  check(r.status === 400 && /Library/.test(r.body.error || ''), 'Walls need Palisades' + (r.status === 400 ? '' : ' — ' + JSON.stringify(r.body)));
  const rsCols = (await q("SELECT column_name FROM information_schema.columns WHERE table_name='settlement_research'")).rows.map(x => x.column_name);
  check(rsCols.length > 0, `research table present (${rsCols.join(',')})`);
  await study(a, 'palisades');
  r = await api(a, 'POST', '/api/buildings/build', { buildingId: 'walls' });
  check(r.status === 200, 'with Palisades: Walls Lv1' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  await q("UPDATE buildings SET level = 2 WHERE settlement_id=$1 AND type='walls'", [a.sid]);
  r = await api(a, 'POST', '/api/buildings/build', { buildingId: 'walls' });
  check(r.status === 400 && /Level 3 Walls needs/.test(r.body.error || ''), 'Walls Lv3 needs Stone Forts');
  let td = await D.townDefence(await sRow(a));
  check(td.walls === 30 && td.own === 30, `Lv2 Walls: 30 town defence (${td.walls})`);
  await study(a, 'signal_fires', 'stone_forts', 'drill_yards', 'bastions');
  td = await D.townDefence(await sRow(a));
  check(td.walls === 39, `Bastions: Walls +30% (${td.walls})`);

  console.log('Outpost forts and crews');
  const b = await player('forts');
  const op = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level) VALUES ($1,$2,0,'hills',2) RETURNING id", [b.sid, b.q + 2])).rows[0].id;
  r = await api(b, 'POST', `/api/game/outposts/${op}/fortify`);
  check(r.status === 400 && /Library/.test(r.body.error), 'a palisade needs Palisades');
  await study(b, 'palisades');
  const w0 = Number((await sRow(b)).wealth);
  r = await api(b, 'POST', `/api/game/outposts/${op}/fortify`);
  check(r.status === 200 && r.body.outpost.fort.level === 1 && r.body.outpost.fort.defence === 10 && Number((await sRow(b)).wealth) < w0, 'fortify: a palisade (+10), paid for' + (r.status === 200 ? '' : ' — ' + JSON.stringify(r.body)));
  check(r.body.outpost.fort.next && r.body.outpost.fort.next.researchMet === false, '…the stockade waits on research');
  const g1 = await cit(b, 'Spear', 'soldier'), g2 = await cit(b, 'Bow', 'archer'), f1 = await cit(b, 'Pick', 'miner'), f2 = await cit(b, 'Shovel', 'miner'), f3 = await cit(b, 'Hoe', 'farmer');
  r = await api(b, 'POST', `/api/game/outposts/${op}/assign`, { citizen_id: f1, post: 'garrison' });
  check(r.status === 400 && /Guards and Archers/.test(r.body.error), 'only Guards and Archers garrison');
  r = await api(b, 'POST', `/api/game/outposts/${op}/assign`, { citizen_id: g1, post: 'garrison' });
  check(r.status === 200 && r.body.outpost.garrison.length === 1 && r.body.outpost.defence.own === 10 + 8 + 1, 'a Guard garrisons it: 10 + 9 defence');
  r = await api(b, 'POST', `/api/game/outposts/${op}/assign`, { citizen_id: g2, post: 'garrison' });
  check(r.status === 400 && /holds 1/.test(r.body.error), 'a palisade holds one');
  r = await api(b, 'POST', `/api/game/outposts/${op}/assign`, { citizen_id: f1 });
  const r2 = await api(b, 'POST', `/api/game/outposts/${op}/assign`, { citizen_id: f2 });
  const r3 = await api(b, 'POST', `/api/game/outposts/${op}/assign`, { citizen_id: f3 });
  check(r.status === 200 && r2.status === 200 && r2.body.outpost.workers.length === 2 && r3.status === 400 && /room for 2 workers/.test(r3.body.error), 'a level 2 outpost takes two workers');
  check(Math.abs(r2.body.outpost.mult - 2) < 1e-9, `two Miners at a Quarry: +100% (×${r2.body.outpost.mult})`);
  const away = await api(b, 'POST', '/api/quests/accept', { quest_id: 'q_gather_herbs', citizen_id: g1 });
  check(away.status === 400 && /outpost|board/.test(away.body.error), 'garrisoned citizens are busy');
  await study(b, 'signal_fires', 'stone_forts', 'drill_yards');
  const od = await D.outpostDefence(await sRow(b), { id: op, fort_level: 1 });
  check(od.garrison === Math.round(9 * 1.25), `Drill Yards: garrison +25% (${od.garrison})`);

  console.log('Clan share');
  const m1 = await player('clanA'), m2 = await player('clanB'), outsider = await player('loner');
  const clan = (await q("INSERT INTO clans (name, founder_user_id) VALUES ($1,$2) RETURNING id", ['Shield' + RUN, m1.id])).rows[0].id;
  await q("INSERT INTO clan_members (user_id, clan_id, rank) VALUES ($1,$2,'founder'),($3,$2,'member')", [m1.id, clan, m2.id]);
  const T = X - 3000 - seq * 10;
  for (let i = 0; i < 4; i++) await q('INSERT INTO clan_territory (q, r, clan_id, claimed_by_user_id) VALUES ($1,0,$2,$3) ON CONFLICT DO NOTHING', [T + i, clan, m1.id]);
  const oA = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, fort_level) VALUES ($1,$2,0,'plains',1,0) RETURNING id", [m1.sid, T])).rows[0].id;
  await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, fort_level) VALUES ($1,$2,0,'plains',1,3)", [m2.sid, T + 1]);
  const oL = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, fort_level) VALUES ($1,$2,0,'plains',1,1) RETURNING id", [outsider.sid, T + 2])).rows[0].id;
  const dA = await R.defenceFor(await sRow(m1), { q: T, r: 0 });
  check(dA.own === 0 && dA.clan === 0, 'clan share is at most the spot\'s own defence — an empty spot gets none');
  await q('UPDATE outposts SET fort_level = 1 WHERE id=$1', [oA]);
  const dA2 = await R.defenceFor(await sRow(m1), { q: T, r: 0 });
  check(dA2.own === 10 && dA2.clan === 10 && dA2.clan_from.length === 1, `a member's fortified spot shares with its neighbour (+${dA2.clan})`);
  const dL = await R.defenceFor(await sRow(outsider), { q: T + 2, r: 0 });
  check(dL.clan === 0, 'a non-member on clan land gets nothing from the clan');
  void oL;

  console.log('Graded raids');
  const c = await player('graded');
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile')`, ['Warren' + RUN, c.q + 3]);
  const oc = (await q("INSERT INTO outposts (settlement_id, tile_q, tile_r, terrain, level, fort_level) VALUES ($1,$2,0,'plains',1,2) RETURNING id", [c.sid, c.q + 2])).rows[0].id;
  const worker = await cit(c, 'Digger', 'farmer'), guard = await cit(c, 'Watch', 'soldier');
  await q("INSERT INTO outpost_crew (citizen_id, outpost_id, post) VALUES ($1,$2,'worker'),($3,$2,'garrison')", [worker, oc, guard]);
  const before = await sRow(c);
  const raid = await R.start(before, { strength: 68 });
  check(raid && raid.outpost_id === oc, 'they come for the outpost');
  await q('UPDATE settlement_raids SET arrives_at = NOW() WHERE id=$1', [raid.id]);
  const res = await R.resolve(raid.id, () => 0.5);   // defence 25 + 9 = 34 vs 68 → half a raid
  const after = await sRow(c);
  check(res.outcome === 'partial' && Math.abs(Number(res.loss_share) - 0.5) < 0.01, `half defended: half a raid (${res.loss_share})`);
  check(Number(before.food) - Number(after.food) === 1000, `…half of the 2,000 food a full raid takes (${Number(before.food) - Number(after.food)})`);
  const hurt = (await q("SELECT citizen_id FROM citizen_events WHERE settlement_id=$1 AND event_type='injury'", [c.sid])).rows.map(x => x.citizen_id);
  check(hurt.includes(worker) && hurt.includes(guard), 'the worker and the guard there are hurt');
  check(!(await q('SELECT 1 FROM outpost_crew WHERE outpost_id=$1', [oc])).rows.length, '…and sent home');
  check(Date.parse((await q('SELECT raided_until FROM outposts WHERE id=$1', [oc])).rows[0].raided_until) > Date.now() + 5 * 3600e3, 'the outpost is idle for half of 12 hours');

  console.log('Tribute');
  const t = await player('tribute');
  await q(`INSERT INTO npc_settlements (name, tile_q, tile_r, faction, species, disposition) VALUES ($1,$2,0,'hostile','withered','hostile')`, ['Warren2' + RUN, t.q + 2]);
  await q("UPDATE settlements SET tier='village' WHERE id=$1", [t.sid]);
  let g = await api(t, 'GET', '/api/raids');
  check(g.body.tribute && g.body.tribute.cost === 400 && g.body.full_raid && g.body.full_raid.food === 2000, 'GET /api/raids quotes tribute and what a full raid would take');
  const tr = await R.start(await sRow(t), {});
  check(tr && g.body.defence && g.body.defence.undefended === true, 'an undefended town is marked so');
  r = await api(t, 'POST', '/api/raids/tribute');
  check(r.status === 200 && r.body.turned_back && r.body.cost === 800, 'paying while raiders come turns them back, at double');
  check((await q('SELECT outcome FROM settlement_raids WHERE id=$1', [tr.id])).rows[0].outcome === 'turned_back', '…the raid is turned back');
  check(!(await R.eligible()).list.some(x => x.s.id === t.sid), 'a town at peace isn\'t raided');
  r = await api(t, 'POST', '/api/raids/tribute');
  check(r.status === 400 && /already paid/.test(r.body.error), 'no paying twice while at peace');
  g = await api(t, 'GET', '/api/raids');
  check(g.body.tribute.peace_until, 'the peace shows');

  console.log('Scouting');
  const sc = await player('scout');
  check(await R.scoutRange(await sRow(sc)) === R.RANGE.base, 'no scouts: ±35%');
  await q("INSERT INTO buildings (settlement_id, type, level) VALUES ($1,'scout_post',1)", [sc.sid]);
  check(await R.scoutRange(await sRow(sc)) === R.RANGE.scout, 'a Scout Post: ±20%');
  await study(sc, 'palisades', 'signal_fires');
  check(await R.scoutRange(await sRow(sc)) === R.RANGE.both, '…and Signal Fires: ±5%');

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
