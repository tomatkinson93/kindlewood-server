// ══════════════════════════════════════════════════════════════════════════
//  construction_test — building time with builders (docs/HOME_SCENE.md Part D,
//  step 12; lib/construction.js, /api/construction, /api/buildings/build).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/construction_test.js
//  (set TEST_ADMIN_ID to an id in ADMIN_USER_IDS for the Dev Tools routes).
//
//  The server under test runs its own worker, which also does the builders'
//  work; so timed checks move a town's clock back ("the builders have had N
//  minutes") and then look at what was done, whoever did it.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function pure() {
  const CN = require('../lib/construction'), C = require('../lib/careers/classes'), { BUILDINGS } = require('../buildings');
  console.log('How much work');
  check(CN.workFor('house', 'starter_house') === 5, 'a house is 5 builder-minutes');
  check(['forager_hut', 'lumber_camp', 'granary', 'farm'].every(t => CN.workFor('building', t) === 3), 'the first things a camp builds are 3 minutes with one builder');
  const firsts = Object.keys(BUILDINGS).filter(t => !BUILDINGS[t].isHousing).map(t => CN.workFor('building', t));
  check(firsts.every(w => w >= 3 && w <= 10), 'every first-level building is 3 to 10', firsts);
  check(Object.keys(BUILDINGS).filter(t => !BUILDINGS[t].isHousing).every(t => CN.CONFIG.FIRST[t] != null), 'each building has its own size (none left to the default)');
  check(near(CN.workFor('upgrade', 'lumber_camp', 2), 3 * Math.pow(2, 1.3), 0.06) && near(CN.workFor('upgrade', 'walls', 5), 10 * Math.pow(5, 1.3), 0.06), 'an upgrade to level n is base × n^1.3');
  check(CN.workFor('upgrade', 'walls', 40) === 120 && CN.workFor('building', 'walls', 1, 5) === 50 && CN.workFor('upgrade', 'walls', 5, 5) === 120, 'never more than 120 (two hours with one builder)');
  check(CN.workFor('building', 'farm', 1, 2) === 6 && CN.workFor('building', 'farm', 1, 0) === 1, 'the live multiplier scales it; nothing is ever instant');

  console.log('The work done');
  const M = 60000, sites = [{ id: 1, work_needed: 3, work_done: 0 }, { id: 2, work_needed: 5, work_done: 0 }];
  let r = CN.advance(sites, 1, 0, 2 * M);
  check(r.sites[0].work_done === 2 && r.finished.length === 0 && r.sites[1].work_done === 0, 'one builder does one unit a minute, on the first site only');
  r = CN.advance(sites, 1, 0, 4 * M);
  check(r.finished.join() === '1' && r.sites[0].finished_at === 3 * M && near(r.sites[1].work_done, 1, 1e-9), 'what is left over when a site finishes carries into the next');
  r = CN.advance(sites, 3, 0, 1 * M);
  check(r.finished.join() === '1' && r.sites[0].finished_at === 1 * M, 'three builders finish in a third of the time');
  r = CN.advance(sites, 2, 0, 10 * M);
  check(r.finished.join() === '1,2' && r.sites[1].finished_at === 4 * M, 'a long time away finishes the whole queue, each at its own moment');
  r = CN.advance(sites, 0, 0, 600 * M);
  check(r.finished.length === 0 && r.sites[0].work_done === 0, 'no builders: no progress, however long');
  check(CN.advance(sites, 1, 5 * M, 5 * M).sites[0].work_done === 0 && sites[0].work_done === 0, 'no time, no work (and the sites given are not changed)');
  check(CN.etas(sites, 2).join() === '2,4' && CN.etas(sites, 0).join() === ',' && CN.etas([{ work_needed: 3, work_done: 2.9 }], 1)[0] === 1, 'an honest estimate for each site in the queue; none while nobody builds');

  console.log('Words and refunds');
  check(CN.namesLine(['Delia Oak']) === 'Delia' && CN.namesLine(['Delia Oak', 'Fenn Elm']) === 'Delia and Fenn' && CN.namesLine(['A', 'B', 'C']) === 'A, B and C' && CN.namesLine(['A', 'B', 'C', 'D', 'E']) === 'A, B and 3 others' && CN.namesLine([]) === '', '"Delia and Fenn"');
  const cost = { timber: 41, stone: 20 };
  check(JSON.stringify(CN.refundFor(cost, 0)) === '{"timber":41,"stone":20}' && JSON.stringify(CN.refundFor(cost, 0.5)) === '{"timber":20,"stone":10}', 'cancel before any work: all of it back; after: half');

  console.log('The builder job');
  const b = C.CLASSES.builder;
  check(b && b.needs === null && b.feature === 'construction' && !b.assignedBy && b.physical, 'a Builder needs no building (a new camp can have one)');
  check(!C.ASSIGNABLE.includes('builder') && C.FEATURED.join() === 'builder' && C.VALID_ROLES.includes('builder'), 'it belongs to building time: never picked at random (a moment, an aptitude) for a town without it');
  check(b.tree.some(n => n.capstone) && b.tree.filter(n => n.effects.some(e => e.type === 'output')).length >= 3 && !b.tree.some(n => n.effects.some(e => e.type === 'build_cost')),
    'its tree is about speed (the Stonemason keeps the discount), with a capstone');
  check(b.tree.find(n => n.capstone).effects[0].type === 'aura' && /10% faster/.test(b.tree.find(n => n.capstone).desc), 'the capstone says its number');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const CN = require('../lib/construction'), N = require('../lib/neighbourhoods');
  const { build, finishAll } = require('./_build');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async ({ on = true, tier = 'camp', res = 5000 } = {}) => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `cn_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -150000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, stone, food, wealth, metal, construction_on)
                        VALUES ($1,$2,2,$3,$4,0,NOW(),$5,$5,$5,$5,$5,$6) RETURNING id`, [u.id, username, tier, tq, res, on])).rows[0];
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, user: u.id, api };
  };
  const mk = async (sid, name, role = 'forager', stage = 'adult') => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, stats, life)
      VALUES ($1,$2,'female',$3,$4,'{"strength":8,"endurance":8,"agility":8,"intelligence":8}','{"happiness":70}') RETURNING id`, [sid, name, role, stage])).rows[0].id;
  const store = async sid => (await q('SELECT timber, stone, food, wealth, metal, construction_waiting FROM settlements WHERE id = $1', [sid])).rows[0];
  const level = async (sid, type) => { const r = (await q('SELECT level FROM buildings WHERE settlement_id = $1 AND type = $2', [sid, type])).rows[0]; return r ? r.level : 0; };
  const sitesOf = async sid => (await q("SELECT * FROM construction_sites WHERE settlement_id = $1 AND status = 'open' ORDER BY position, id", [sid])).rows;
  const news = async (sid, like) => (await q("SELECT message FROM settlement_events WHERE settlement_id = $1 AND type = 'construction' AND message LIKE $2 ORDER BY id", [sid, like])).rows.map(r => r.message);
  // "The builders have had this many minutes": the town's clock goes back, then the work is done.
  const pass = async (sid, minutes) => { await q("UPDATE settlements SET construction_at = NOW() - ($2 || ' seconds')::interval WHERE id = $1", [sid, Math.round(minutes * 60)]); await CN.work(sid); };
  let x;

  console.log('Off: everything is as it was');
  {
    const t = await mkTown({ on: false });
    const who = await mk(t.id, 'Idle Ida');
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'lumber_camp' });
    check(x.status === 200 && !x.body.queued && x.body.newLevel === 1 && await level(t.id, 'lumber_camp') === 1, 'with building time off a building stands the moment it is paid for');
    x = await t.api('GET', '/api/construction');
    check(x.status === 200 && x.body.queue.on === false && x.body.queue.sites.length === 0, 'and there is no queue');
    x = await t.api('PATCH', `/api/citizens/${who}/role`, { role: 'builder' });
    check(x.status === 400 && /nothing for a builder/.test(x.body.error), 'the Builder job is not offered');
    const before = await store(t.id);
    const two = await Promise.all([t.api('POST', '/api/buildings/build', { buildingId: 'granary' }), t.api('POST', '/api/buildings/build', { buildingId: 'granary' })]);
    const after = await store(t.id), lv = await level(t.id, 'granary');
    check(two.every(r => r.status === 200) && lv === 2 && before.timber - after.timber === 60 + 120, 'two presses at once are two honest builds (level 1, then 2), each paid at its own price', { lv, paid: before.timber - after.timber });
  }

  console.log('On: paying starts a site');
  const t = await mkTown();
  const ada = await mk(t.id, 'Ada Oak'), bea = await mk(t.id, 'Bea Elm'), kid = await mk(t.id, 'Kit Oak', 'idle', 'child');
  {
    const before = await store(t.id);
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'lumber_camp' });
    const after = await store(t.id);
    check(x.status === 200 && x.body.queued === true && x.body.site && x.body.site.work_needed === 3, 'the order is taken and a site of 3 builder-minutes begins', x.body);
    check(before.stone - after.stone === 30 && before.food - after.food === 40, 'the cost is paid when it is ordered');
    check(await level(t.id, 'lumber_camp') === 0, 'the building does not stand yet (a new building does nothing until finished)');
    check(x.body.no_builder === true && x.body.builders === 0, 'the answer says nobody is a builder, so the screen can say so at once');
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'lumber_camp' });
    check(x.status === 400 && /already being worked on/.test(x.body.error) && (await store(t.id)).stone === after.stone, 'it cannot be ordered twice (and the second order costs nothing)');
    x = await t.api('GET', '/api/buildings');
    const lc = x.body.buildings.find(b => b.id === 'lumber_camp');
    check(lc.site && lc.site.kind === 'building' && lc.canUpgrade === false && lc.currentLevel === 0 && x.body.construction.on && x.body.construction.queued === 1, 'the buildings list shows it as being built');
    check(x.body.buildings.find(b => b.id === 'granary').work === 3 && x.body.buildings.find(b => b.id === 'walls').work === 10, 'and how much work each other thing would be');
    await t.api('POST', '/api/buildings/build', { buildingId: 'granary' });
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'farm' });
    check(x.status === 400 && /Requires Granary/.test(x.body.error), 'what a building needs must be standing: a site does not count');
  }

  console.log('No builders means no progress, said once');
  {
    await pass(t.id, 30);
    await pass(t.id, 30);
    const s0 = await sitesOf(t.id);
    check(s0.length === 2 && s0.every(s => Number(s.work_done) === 0), 'an hour with no builder: nothing done');
    const lines = await news(t.id, '%nobody in town is a builder%');
    check(lines.length === 1 && /Lumber Camp/.test(lines[0]) && (await store(t.id)).construction_waiting === true, 'one news line says why, not one a minute', lines);
    x = await t.api('GET', '/api/construction');
    check(x.body.queue.waiting === true && x.body.queue.sites[0].eta_minutes === null && x.body.queue.rate === 0, 'the queue says it is waiting for a builder, with no estimate');
    x = await t.api('PATCH', `/api/citizens/${kid}/role`, { role: 'builder' });
    check(x.status === 400, 'a child cannot be the builder');
  }

  console.log('Builders work on the first site, around the clock');
  {
    x = await t.api('PATCH', `/api/citizens/${ada}/role`, { role: 'builder' });
    check(x.status === 200, 'a grown-up takes the Builder job (it needs no building)', x.body);
    const crew = await CN.builders(t.id);
    check(crew.length === 1 && crew[0].id === ada && near(crew[0].rate, 1, 0.35), 'she is the crew; an ordinary builder does about one unit a minute', crew);
    x = await t.api('GET', '/api/construction');
    check(x.body.queue.waiting === false && x.body.queue.builders.length === 1 && x.body.queue.sites[0].eta_minutes >= 2 && x.body.queue.sites[1].eta_minutes > x.body.queue.sites[0].eta_minutes, 'now there is an estimate for each site', x.body.queue.sites.map(s => s.eta_minutes));
    const rate = crew[0].rate;
    await pass(t.id, 1);
    let ss = await sitesOf(t.id);
    check(ss.length === 2 && near(Number(ss[0].work_done), rate, 0.45) && Number(ss[1].work_done) === 0, 'a minute of work goes into the first site only', ss.map(s => Number(s.work_done)));
    check((await store(t.id)).construction_waiting === false, 'the wait is over');
    await pass(t.id, 4 / rate);
    ss = await sitesOf(t.id);
    check(await level(t.id, 'lumber_camp') === 1 && ss.length === 1 && ss[0].building_type === 'granary' && Number(ss[0].work_done) > 0.5, 'the Lumber Camp is finished and the rest of the work carried into the Granary', ss.map(s => [s.building_type, Number(s.work_done)]));
    const lines = await news(t.id, '%Lumber Camp is finished%');
    check(lines.length === 1 && /built by Ada\.$/.test(lines[0]), 'a news line names the builder', lines);
    const chron = (await q("SELECT text, citizen_ids FROM chronicle WHERE settlement_id = $1 AND kind = 'town' AND text LIKE '%Lumber Camp%'", [t.id])).rows;
    check(chron.length === 1 && chron[0].citizen_ids.includes(ada), 'and so does the chronicle');
    const ms = (await q("SELECT 1 FROM player_milestones WHERE user_id = $1 AND key = 'first_built'", [t.user]).catch(() => ({ rows: [] }))).rows.length;
    check(ms === 1, 'the funnel records the first building finished');
    await t.api('PATCH', `/api/citizens/${bea}/role`, { role: 'builder' });
    check(near((await t.api('GET', '/api/construction')).body.queue.rate, rate * 2, 0.4), 'a second builder doubles the pace');
    await pass(t.id, 3);
    check(await level(t.id, 'granary') === 1 && (await sitesOf(t.id)).length === 0, 'the Granary is finished');
    check(/built by (Ada and Bea|Bea and Ada)\.$/.test((await news(t.id, '%Granary is finished%'))[0] || ''), 'by both of them', await news(t.id, '%Granary is finished%'));
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'farm' });
    check(x.status === 200 && x.body.queued && x.body.no_builder === false && x.body.builders === 2, 'now the Farm can be ordered, and there are builders for it');
    await pass(t.id, 3);
    check(await level(t.id, 'farm') === 1, 'a site ordered into an empty queue starts from when it was ordered');
  }

  console.log('An upgrade leaves the building working');
  {
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'lumber_camp' });
    const ss = await sitesOf(t.id);
    check(x.status === 200 && ss.length === 1 && ss[0].kind === 'upgrade' && ss[0].level === 2 && near(Number(ss[0].work_needed), 7.4, 0.06), 'an upgrade is a bigger site (3 × 2^1.3)', ss.map(s => Number(s.work_needed)));
    check(await level(t.id, 'lumber_camp') === 1, 'the Lumber Camp keeps working at level 1 meanwhile');
    x = await t.api('GET', '/api/buildings');
    const lc = x.body.buildings.find(b => b.id === 'lumber_camp');
    check(lc.currentLevel === 1 && lc.site && lc.site.level === 2 && lc.canUpgrade === false, 'and is shown as being upgraded');
    await pass(t.id, 6);
    check(await level(t.id, 'lumber_camp') === 2 && /Lumber Camp is now level 2, the work of/.test((await news(t.id, '%now level 2%'))[0] || ''), 'finished: level 2');
  }

  console.log('A house');
  {
    const town = (await q('SELECT id, tier FROM settlements WHERE id = $1', [t.id])).rows[0];
    let nb = await N.list(town);
    const hood = nb.neighbourhoods[0], plot = hood.open[0], bedsBefore = nb.beds, free = hood.free;
    const before = await store(t.id);
    x = await t.api('POST', `/api/neighbourhoods/${hood.id}/houses`, { plot, style: 'stone' });
    check(x.status === 200 && x.body.queued === true && x.body.site.plot === plot && before.timber - (await store(t.id)).timber === 40, 'a house is paid for and its site takes the plot', x.body.error);
    nb = x.body.town;
    check(nb.neighbourhoods[0].sites.length === 1 && nb.neighbourhoods[0].sites[0].plot === plot && nb.neighbourhoods[0].sites[0].style === 'stone' && nb.neighbourhoods[0].free === free - 1 && nb.building === 1, 'the Neighbourhood shows the site on its plot');
    check(nb.beds === bedsBefore && nb.houses === 0, 'no beds until it is finished');
    check(nb.cost.timber === 80, 'the next house is priced as the second');
    x = await t.api('POST', `/api/neighbourhoods/${hood.id}/houses`, { plot });
    check(x.status === 400 && /already being built on that plot/.test(x.body.error), 'the plot cannot be built on twice');
    x = await t.api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
    check(x.status === 200 && x.body.queued && x.body.site.plot !== plot && (await sitesOf(t.id)).length === 2, 'the old Build button queues a home on the next free plot');
    await pass(t.id, 6);
    nb = await N.list(town);
    const h = nb.neighbourhoods[0].houses;
    check(h.length === 2 && h.some(o => o.plot === plot && o.style === 'stone') && nb.neighbourhoods[0].sites.length === 0 && nb.beds === bedsBefore + 8, 'finished: the houses stand on their plots, with their beds', h.map(o => [o.plot, o.style]));
    const homeless = (await q("SELECT COUNT(*)::int AS n FROM citizens WHERE settlement_id = $1 AND house_id IS NULL AND COALESCE(life_stage,'adult') <> 'deceased'", [t.id])).rows[0].n;
    check(homeless === 0, 'and housing sorts itself: everyone has a bed');
    check(/^🏡 A new home is finished \(Willow Hut #\d+\), built by/.test((await news(t.id, '%new home is finished%'))[0] || ''), 'a news line for the home', await news(t.id, '%new home%'));
    const rows = (await q("SELECT COUNT(*)::int AS n FROM buildings WHERE settlement_id = $1 AND type = 'starter_house'", [t.id])).rows[0].n;
    check(rows === 2, 'the buildings count of homes stays in step');
  }

  console.log('The queue: five at most, reorder, cancel');
  const u = await mkTown({ tier: 'village', res: 20000 });
  {
    for (const b of ['forager_hut', 'lumber_camp', 'granary', 'tavern', 'market']) await u.api('POST', '/api/buildings/build', { buildingId: b });
    const before = await store(u.id);
    x = await u.api('POST', '/api/buildings/build', { buildingId: 'mine' });
    check(x.status === 400 && /already have 5 things to build/.test(x.body.error) && (await store(u.id)).timber === before.timber, 'a sixth order is refused, and nothing is paid');
    x = await u.api('POST', '/api/buildings/build', { buildingId: 'starter_house' });
    check(x.status === 400 && /5 things to build/.test(x.body.error), 'a house too');
    let ss = await sitesOf(u.id);
    const ids = ss.map(s => s.id);
    x = await u.api('POST', '/api/construction/reorder', { ids: [ids[4], ids[0], ids[1], ids[2], ids[3]] });
    check(x.status === 200 && x.body.queue.sites[0].type === 'market' && x.body.queue.sites[1].type === 'forager_hut', 'the player can put another site first');
    x = await u.api('POST', '/api/construction/reorder', { ids: [ids[0], ids[1]] });
    check(x.status === 409, 'an order that does not match the queue is refused');
    x = await u.api('POST', '/api/construction/reorder', { ids: [ids[0], ids[0], ids[1], ids[2], ids[3]] });
    check(x.status === 409, 'or one that names a site twice');
    // Cancel before any work: all of it back.
    let st = await store(u.id);
    x = await u.api('POST', `/api/construction/sites/${ids[3]}/cancel`);
    let st2 = await store(u.id);
    check(x.status === 200 && x.body.cancelled.full === true && st2.timber - st.timber === 80 && st2.food - st.food === 60 && st2.wealth - st.wealth === 40 && x.body.queue.sites.length === 4, 'cancelled before any work: the whole cost comes back', x.body.cancelled);
    // After some work: half.
    const w = await mk(u.id, 'Wil Ash', 'builder');
    await pass(u.id, 1);
    ss = await sitesOf(u.id);
    check(ss[0].building_type === 'market' && Number(ss[0].work_done) > 0, 'work has begun on the Market');
    st = await store(u.id);
    x = await u.api('POST', `/api/construction/sites/${ss[0].id}/cancel`);
    st2 = await store(u.id);
    check(x.status === 200 && x.body.cancelled.full === false && st2.timber - st.timber === 30 && st2.food - st.food === 15 && await level(u.id, 'market') === 0, 'cancelled after work began: half comes back', x.body.cancelled);
    x = await u.api('POST', `/api/construction/sites/${ss[0].id}/cancel`);
    check(x.status === 404, 'a site cannot be cancelled twice');
    const other = await mkTown();
    x = await other.api('POST', `/api/construction/sites/${ids[0]}/cancel`);
    check(x.status === 404 && (await sitesOf(u.id)).some(s => s.id === ids[0]), 'nor another town\'s');
    x = await other.api('POST', '/api/construction/reorder', { ids });
    check(x.status === 409, 'nor reordered by another town');
    void w;
  }

  console.log('Two devices, a death, a demolition');
  {
    const v = await mkTown();
    const b1 = await mk(v.id, 'Sole Builder', 'builder');
    const before = await store(v.id);
    const two = await Promise.all([v.api('POST', '/api/buildings/build', { buildingId: 'mine' }), v.api('POST', '/api/buildings/build', { buildingId: 'mine' })]);
    const after = await store(v.id);
    check(two.filter(r => r.status === 200).length === 1 && (await sitesOf(v.id)).length === 1 && before.timber - after.timber === 60, 'two devices ordering the same thing at once: one site, paid once', two.map(r => r.status));
    await pass(v.id, 1);
    const done = Number((await sitesOf(v.id))[0].work_done);
    await Promise.all([CN.work(v.id), CN.work(v.id), v.api('GET', '/api/construction'), v.api('GET', '/api/construction')]);
    check(near(Number((await sitesOf(v.id))[0].work_done), done, 0.3), 'the same minute is never worked twice, however many ask', [done, Number((await sitesOf(v.id))[0].work_done)]);
    await q("UPDATE citizens SET life_stage = 'deceased' WHERE id = $1", [b1]);
    await pass(v.id, 30);
    check((await sitesOf(v.id)).length === 1 && (await news(v.id, '%nobody in town is a builder%')).length === 1, 'the last builder dies: work stops, and a news line says so');
    await q("UPDATE citizens SET life_stage = 'adult' WHERE id = $1", [b1]);
    await pass(v.id, 10);
    check(await level(v.id, 'mine') === 1, 'a builder again: it is finished');
    // An upgrade under way when the building comes down.
    await v.api('POST', '/api/buildings/build', { buildingId: 'mine' });
    const st = await store(v.id);
    x = await v.api('POST', '/api/buildings/remove', { buildingId: 'mine' });
    const st2 = await store(v.id);
    check(x.status === 200 && (await sitesOf(v.id)).length === 0 && st2.timber - st.timber >= 30 + 60, 'demolishing a building stops its upgrade and refunds it', { got: st2.timber - st.timber, refund: x.body.refund });
    // A Scout Post lifts the fog when it is finished, not when it is ordered.
    await v.api('POST', '/api/buildings/build', { buildingId: 'scout_post' });
    const fog0 = (await q('SELECT COUNT(*)::int AS n FROM fog_of_war WHERE user_id = $1', [v.user])).rows[0].n;
    await pass(v.id, 10);
    const fog1 = (await q('SELECT COUNT(*)::int AS n FROM fog_of_war WHERE user_id = $1', [v.user])).rows[0].n;
    check(fog0 === 0 && fog1 > 50 && await level(v.id, 'scout_post') === 1, 'a Scout Post lifts the fog when it is finished', [fog0, fog1]);
  }

  console.log('Tiers, first steps, and tests');
  {
    const w = await mkTown();
    await mk(w.id, 'Bo Builder', 'builder');
    x = await w.api('GET', '/api/game/first-steps');
    check(x.status === 200 && x.body.steps[0].key === 'builder' && x.body.steps[0].done === true, '"Make someone a builder" comes first in the first steps, for a town with building time');
    const off = await mkTown({ on: false });
    x = await off.api('GET', '/api/game/first-steps');
    check(x.status === 200 && !x.body.steps.some(s => s.key === 'builder'), 'and is not shown where building time is off');
    x = await w.api('GET', '/api/game/settlement');
    const y = await off.api('GET', '/api/game/settlement');
    check(x.status === 200 && x.body.settlement.building_time === true && y.body.settlement.building_time === false, 'the town says whether building time is on (so the screen offers the Builder job only then)');
    const defs = require('../lib/careers').defs();
    check(defs.classes.builder && defs.classes.builder.feature === 'construction' && defs.classes.builder.assignable === true && defs.classes.farmer.feature === null, 'and the job list marks Builder as belonging to building time');
    await w.api('POST', '/api/buildings/build', { buildingId: 'forager_hut' });
    await w.api('POST', '/api/buildings/build', { buildingId: 'lumber_camp' });
    x = await w.api('GET', '/api/game/tier-info');
    check(x.status === 200 && x.body.requirementsMet.current.buildings === 0, 'buildings still going up do not count toward the next tier');
    check(await finishAll(w.id) === 2 && await level(w.id, 'forager_hut') === 1 && await level(w.id, 'lumber_camp') === 1, 'finishAll (tests, Dev Tools) finishes the queue in order');
    const r = await build(w.api, w.id, 'granary');
    check(r.status === 200 && r.body.queued && await level(w.id, 'granary') === 1 && (await sitesOf(w.id)).length === 0, 'the test helper orders as a player does, then finishes the site: one clear way through');
    const r2 = await build(off.api, off.id, 'granary');
    check(r2.status === 200 && !r2.body.queued && await level(off.id, 'granary') === 1, 'and is the same call where building time is off');
    check(await CN.setBuilders(w.id, 0) === 0 && await CN.setBuilders(w.id, 1) === 1, 'Dev Tools can set how many builders a town has');
  }

  console.log('Dev Tools routes');
  {
    const ADMIN = Number(process.env.TEST_ADMIN_ID || 0);
    const plain = await mkTown();
    x = await plain.api('POST', '/api/construction/admin/finish', {});
    check(x.status === 403, 'not for players');
    x = await plain.api('POST', '/api/construction/admin/switch', { on: true });
    check(x.status === 403 && !(await require('../lib/tuning').switchOn('construction.on')), 'a player cannot switch building time on');
    if (ADMIN) {
      const an = `cnadmin_${ADMIN}`;
      await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username", [ADMIN, an, `${an}@t.l`]);
      let as = (await q('SELECT id FROM settlements WHERE user_id = $1', [ADMIN])).rows[0];
      if (!as) as = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, stone, food) VALUES ($1,$2,2,'camp',$3,0,NOW(),5000,5000,5000) RETURNING id`, [ADMIN, an, -190000 - Math.floor(Math.random() * 1000) * 20])).rows[0];
      await q("UPDATE settlements SET timber = 5000, stone = 5000, food = 5000 WHERE id = $1", [as.id]);
      await q("DELETE FROM construction_sites WHERE settlement_id = $1", [as.id]);
      await q("DELETE FROM buildings WHERE settlement_id = $1 AND type = 'fishing_post'", [as.id]);
      const tok = jwt.sign({ userId: ADMIN, username: an, species: 'Mice' }, SECRET);
      const api = async (method, pth, body) => { const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
      x = await api('POST', '/api/construction/admin/town', { on: true });
      check(x.status === 200 && x.body.on === true && x.body.queue.on === true, 'an admin turns building time on for their own town');
      await api('POST', '/api/buildings/build', { buildingId: 'fishing_post' });
      x = await api('POST', '/api/construction/admin/finish', {});
      check(x.status === 200 && x.body.finished.site.type === 'fishing_post' && await level(as.id, 'fishing_post') === 1 && x.body.queue.sites.length === 0, 'and finishes a site now');
      x = await api('POST', '/api/construction/admin/finish', {});
      check(x.status === 404, 'with nothing being built it says so');
      x = await api('POST', '/api/construction/admin/town', { on: false });
      check(x.status === 200 && x.body.queue.on === false, 'and off again');
    } else console.log('  (admin routes skipped — set TEST_ADMIN_ID)');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
