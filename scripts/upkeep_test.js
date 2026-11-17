// ══════════════════════════════════════════════════════════════════════════
//  upkeep_test — building health (docs/HOME_SCENE.md Part E, step 17;
//  lib/upkeep.js, /api/upkeep).
//   DATABASE_URL=postgres://… QUEST_TEST_BASE=http://localhost:3999 node scripts/upkeep_test.js
//
//  The server under test runs its own worker, which also does this work; so
//  timed checks move a town's clock back ("this much time has passed") and
//  look at what happened, whoever did it.
// ══════════════════════════════════════════════════════════════════════════
'use strict';

let passed = 0, failed = 0;
function check(cond, msg, extra) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.log('  FAIL', msg, extra !== undefined ? '— ' + JSON.stringify(extra) : ''); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

function pure() {
  const U = require('../lib/upkeep');
  console.log('Health and its three states');
  check(U.stateOf(100) === 'sound' && U.stateOf(60) === 'sound' && U.stateOf(59.9) === 'worn' && U.stateOf(1) === 'worn' && U.stateOf(0) === 'broken', 'sound from 60, worn under it, broken at nothing');

  console.log('Who wears first');
  const B = (id, type) => ({ kind: 'building', id, type, health: 100 }), H = id => ({ kind: 'house', id, name: 'Hut ' + id, health: 100 });
  const town = [B(1, 'granary'), B(2, 'farm'), H(11), B(3, 'jeweller'), H(12), B(4, 'tavern'), B(5, 'lumber_camp'), B(6, 'windmill')];
  const order = U.rank(town).map(u => (u.kind === 'house' ? 'h' + u.id : u.type));
  check(order.join() === 'jeweller,tavern,lumber_camp,farm,windmill,h12,h11,granary', 'the least important first; homes after every building (the newest first); the Granary last of all', order);
  let p = U.plan(town, 0, 8);
  check(p.covered === 0 && p.wearing.length === 8, 'no builders: everything wears');
  p = U.plan(town, 1, 6);
  check(p.covered === 6 && p.total === 8 && p.wearing.map(u => u.type).join() === 'jeweller,tavern', 'one builder covers the most important six; the two least important wear');
  check(U.plan(town, 1, 8).wearing.length === 0 && U.plan(town, 3, 8).covered === 8, 'enough builders: nothing wears');

  console.log('Wear and repair');
  const day = 1440;
  let r = U.step(town, { wearing: town, minutes: day, daysToBreak: 5 });
  check(r.units.every(u => u.health === 80) && !r.broke.length, 'a sound building nobody looks after loses a fifth a day (five days to break)');
  r = U.step(town, { wearing: [town[3]], minutes: 6 * day, daysToBreak: 5 });
  check(r.units[3].health === 0 && r.broke.length === 1 && r.broke[0].type === 'jeweller' && r.units[0].health === 100, 'it stops at nothing: broken is the floor, and only the uncovered wear');
  const hurt = [{ ...B(1, 'farm'), health: 40 }, { ...B(2, 'tavern'), health: 0 }, { ...B(3, 'mine'), health: 90 }];
  r = U.step(hurt, { repair: 30 });
  check(r.units[1].health === 30 && r.units[0].health === 40 && r.mended.length === 1 && r.spent === 30, 'builders mend the most damaged first, one health a builder-minute');
  r = U.step(hurt, { repair: 200 });
  check(r.units.every(u => u.health === 100) && r.spent === 170, 'and stop when everything is whole');
  r = U.step([{ ...B(1, 'farm'), health: 100 }], { wearing: [B(1, 'farm')], minutes: 60, daysToBreak: 5, repair: 60 });
  check(r.units[0].health === 100, 'a builder with nothing else to do keeps up with the wear');
  check(U.step(hurt, { minutes: 0 }).units.map(u => u.health).join() === '40,0,90' && hurt[1].health === 0, 'no time, no change (and the units given are not changed)');

  console.log('The line on the town card');
  check(U.line(2, 16, 19) === 'Upkeep: 2 builders look after 16 of 19 buildings' && U.line(1, 8, 8) === 'Upkeep: 1 builder looks after 8 of 8 buildings', '"Upkeep: 2 builders look after 16 of 19 buildings"');
  check(/nobody is looking after the town's 5 buildings/.test(U.line(0, 0, 5)), 'with no builder it says so');
}

async function main() {
  pure();
  if (!process.env.DATABASE_URL) { console.log('(database parts skipped — set DATABASE_URL and QUEST_TEST_BASE)'); return; }
  const { pool } = require('../db');
  const jwt = require('jsonwebtoken');
  const U = require('../lib/upkeep'), CN = require('../lib/construction'), N = require('../lib/neighbourhoods');
  const BASE = process.env.QUEST_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const q = (t, p) => pool.query(t, p);
  const mkTown = async ({ tier = 'village', on = true, types = ['granary', 'farm', 'tavern', 'jeweller', 'lumber_camp'], homes = 2 } = {}) => {
    const RUN = Math.random().toString(36).slice(2, 8), username = `uk_${RUN}`;
    const u = (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    const tq = -210000 - Math.floor(Math.random() * 5000) * 20;
    const s = (await q(`INSERT INTO settlements (user_id, name, world_version, tier, tile_q, tile_r, last_tick, timber, stone, food, wealth, metal, upkeep_on, upkeep_at)
                        VALUES ($1,$2,2,$3,$4,0,NOW(),5000,5000,5000,5000,5000,$5,NOW()) RETURNING id`, [u.id, username, tier, tq, on])).rows[0];
    for (const t of types) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,1)', [s.id, t]);
    for (let i = 0; i < homes; i++) await q("INSERT INTO houses (settlement_id, name, building_type, capacity) VALUES ($1,$2,'starter_house',4)", [s.id, `Willow Hut #${i + 1}`]);
    await N.seat(s.id);
    const token = jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET);
    const api = async (method, pth, body) => {
      const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    return { id: s.id, user: u.id, api };
  };
  const mk = async (sid, name, role = 'forager', house = null) => (await q(`INSERT INTO citizens (settlement_id, name, gender, role, life_stage, stats, life, house_id)
      VALUES ($1,$2,'female',$3,'adult','{"strength":8,"endurance":8,"agility":8,"intelligence":8}','{"happiness":70}',$4) RETURNING id`, [sid, name, role, house])).rows[0].id;
  const health = async (sid, type) => Number((await q('SELECT health FROM buildings WHERE settlement_id = $1 AND type = $2', [sid, type])).rows[0].health);
  const homes = async sid => (await q('SELECT id, health FROM houses WHERE settlement_id = $1 ORDER BY id', [sid])).rows.map(r => ({ id: r.id, health: Number(r.health) }));
  const news = async (sid, like) => (await q("SELECT message FROM settlement_events WHERE settlement_id = $1 AND type IN ('upkeep','construction') AND message LIKE $2 ORDER BY id", [sid, like])).rows.map(r => r.message);
  // "This much time has passed": the town's clock goes back, then the work is done.
  const pass = async (sid, minutes) => { await q("UPDATE settlements SET upkeep_at = NOW() - ($2 || ' seconds')::interval WHERE id = $1", [sid, Math.round(minutes * 60)]); await U.work(sid); };
  const DAY = 1440;
  let x;

  console.log('Off, and camps');
  {
    const off = await mkTown({ on: false });
    await pass(off.id, 10 * DAY);
    check(await health(off.id, 'tavern') === 100 && (await U.status(off.id)).on === false, 'with upkeep off nothing wears, however long');
    const camp = await mkTown({ tier: 'camp' });
    await pass(camp.id, 10 * DAY);
    x = await camp.api('GET', '/api/upkeep');
    check(await health(camp.id, 'tavern') === 100 && x.status === 200 && x.body.upkeep.on === false && x.body.upkeep.exempt === true, 'a Camp is exempt: a new player learns building first');
    x = await camp.api('POST', '/api/upkeep/repair', { type: 'tavern' });
    check(x.status === 400, 'and has nothing to repair');
  }

  console.log('Nobody looks after the town');
  const t = await mkTown();
  {
    await pass(t.id, DAY);
    const hs = await homes(t.id);
    check(near(await health(t.id, 'tavern'), 80, 0.5) && near(await health(t.id, 'granary'), 80, 0.5) && near(hs[0].health, 80, 0.5), 'a day with no builder: every building and home is a fifth worn', [await health(t.id, 'tavern'), hs[0].health]);
    await pass(t.id, 60);
    check((await news(t.id, '%Nobody is looking after the town%')).length === 1, 'one news line says so, not one a minute');
    x = await t.api('GET', '/api/upkeep');
    check(x.status === 200 && x.body.upkeep.on && x.body.upkeep.builders === 0 && x.body.upkeep.covered === 0 && x.body.upkeep.total === 7 && x.body.upkeep.short === true && /nobody is looking after/.test(x.body.upkeep.line), 'the town card says nobody is looking after its 7 buildings', x.body.upkeep);
    x = await t.api('GET', '/api/buildings');
    const tv = x.body.buildings.find(b => b.id === 'tavern');
    check(tv.health >= 78 && tv.health <= 80 && tv.state === 'sound' && x.body.upkeep.on === true, 'the buildings list carries each one\'s health and state');
    await pass(t.id, 2 * DAY);
    check((await t.api('GET', '/api/buildings')).body.buildings.find(b => b.id === 'tavern').state === 'worn', 'under 60 it is worn (and still works)');
    const st0 = await require('../lib/careers').loadState(null, t.id);
    check(st0.buildings.some(b => b.type === 'tavern'), 'a worn building still counts for work');
    await pass(t.id, 3 * DAY);
    check(await health(t.id, 'tavern') === 0 && (await homes(t.id)).every(h => h.health === 0), 'after five days everything is broken; nothing goes below that');
    const broke = await news(t.id, '%fallen into disrepair%');
    check(broke.length === 7 && broke.some(m => /The Tavern has fallen into disrepair and gives nothing/.test(m)) && broke.some(m => /Willow Hut #\d has fallen into disrepair\. Its family still lives there/.test(m)), 'a news line for each thing that broke', broke.length);
    const st = await require('../lib/careers').loadState(null, t.id);
    check(!st.buildings.some(b => b.type === 'tavern') && (await q('SELECT COUNT(*)::int AS n FROM buildings WHERE settlement_id = $1', [t.id])).rows[0].n >= 5, 'a broken building gives nothing (it is left out of what the town produces) but is never destroyed');
    x = await t.api('GET', '/api/game/settlement');
    check(x.status === 200 && x.body.buildings && x.body.buildings.some(b => b.type === 'tavern' && b.health === 0), 'the town still lists it, at health 0');
    const nb = await N.list((await q('SELECT id, tier, upkeep_on FROM settlements WHERE id = $1', [t.id])).rows[0]);
    check(nb.beds === 8 && nb.neighbourhoods[0].houses.every(h => h.health === 0 && h.condition === 'broken'), 'a broken home keeps its beds');
  }

  console.log('Builders mend when they have nothing to build');
  {
    const ada = await mk(t.id, 'Ada Oak', 'builder');
    await pass(t.id, 30);
    const all = await U.units(q, t.id);
    const total = all.reduce((a, u) => a + u.health, 0);
    check(total > 15 && total < 45 && all.filter(u => u.health > 0).length >= 1, 'half an hour with one builder: about thirty health mended', Math.round(total));
    check((await news(t.id, '%has been mended%')).length >= 1, 'a news line when something is working again');
    await pass(t.id, 12 * 60);
    check((await U.units(q, t.id)).every(u => u.health === 100), 'a day\'s work and the town is whole again (nothing was lost for good)');
    x = await t.api('GET', '/api/upkeep');
    check(x.body.upkeep.builders === 1 && x.body.upkeep.covered === 7 && x.body.upkeep.short === false && x.body.upkeep.line === 'Upkeep: 1 builder looks after 7 of 7 buildings', 'the town card: 1 builder looks after 7 of 7 buildings', x.body.upkeep.line);
    void ada;
  }

  console.log('Too few builders');
  {
    const big = await mkTown({ types: ['granary', 'farm', 'tavern', 'jeweller', 'lumber_camp', 'library', 'market', 'smithy', 'workshop', 'mine'], homes: 2 });
    await mk(big.id, 'Bo Builder', 'builder');
    x = await big.api('GET', '/api/upkeep');
    check(x.body.upkeep.covered === 8 && x.body.upkeep.total === 12 && x.body.upkeep.short && x.body.upkeep.wearing.map(u => u.type).join() === 'jeweller,library,tavern,market', 'one builder covers 8 of 12; the four least important are the ones at risk', x.body.upkeep.wearing.map(u => u.type));
    // Kept busy building, the builder mends nothing: the uncovered wear.
    await big.api('POST', '/api/construction/admin/town', { on: true });
    await q('UPDATE settlements SET construction_on = TRUE WHERE id = $1', [big.id]);
    await q("INSERT INTO construction_sites (settlement_id, kind, building_type, level, cost, work_needed, position) VALUES ($1,'building','scout_post',1,'{}',100000,1)", [big.id]);
    await pass(big.id, DAY);
    check(near(await health(big.id, 'jeweller'), 80, 0.6) && await health(big.id, 'granary') === 100 && await health(big.id, 'farm') === 100, 'while the builder is busy building, the uncovered wear and the covered do not', [await health(big.id, 'jeweller'), await health(big.id, 'granary')]);
    // Repair now: at the front of the queue.
    x = await big.api('POST', '/api/upkeep/repair', { type: 'jeweller' });
    const sites = (await q("SELECT id, kind, building_type, work_needed, position FROM construction_sites WHERE settlement_id = $1 AND status = 'open' ORDER BY position, id", [big.id])).rows;
    check(x.status === 200 && x.body.repair.site.kind === 'repair' && sites[0].kind === 'repair' && sites[0].building_type === 'jeweller' && near(Number(sites[0].work_needed), 20, 0.7), '"Repair now" puts the repair at the front of the builders\' queue, sized by the damage', sites.map(s => [s.kind, Number(s.work_needed)]));
    x = await big.api('POST', '/api/upkeep/repair', { type: 'jeweller' });
    check(x.status === 400 && /already have that repair in hand/.test(x.body.error), 'it cannot be asked for twice');
    x = await big.api('POST', '/api/upkeep/repair', { type: 'granary' });
    check(x.status === 400 && /needs no repair/.test(x.body.error), 'nor for something that is whole');
    x = await big.api('POST', '/api/upkeep/repair', { type: 'castle' });
    check(x.status === 404, 'nor for something the town does not have');
    x = await big.api('GET', '/api/buildings');
    const jw = x.body.buildings.find(b => b.id === 'jeweller');
    check(jw.repair && jw.repair.id === sites[0].id && jw.site === null, 'the buildings list shows the repair in hand (it is not an upgrade)');
    x = await big.api('GET', '/api/construction');
    check(x.body.queue.sites[0].label === 'Repair: Jeweller' && x.body.queue.sites[0].icon === '🛠️' && Object.keys(x.body.queue.sites[0].refund).length === 0, 'and the queue names it; a repair costs no materials, so cancelling gives nothing back');
    await CN.finishNow(big.id, sites[0].id);
    check(await health(big.id, 'jeweller') === 100 && /The Jeweller has been mended( by \w+)?\.$/.test((await news(big.id, '%Jeweller has been mended%')).pop() || ''), 'finished: whole again, and the news says so', await news(big.id, '%Jeweller%'));
    check(CN.namesLine(['Bo Builder']) === 'Bo' && /has been mended\$\{by \? ` by \$\{by\}` : ''\}/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'lib', 'construction.js'), 'utf8')), '(naming the builders who worked on it)');
    // A home.
    const hs = await homes(big.id);
    const res = await mk(big.id, 'Res Ident', 'forager', hs[0].id);
    await q('UPDATE houses SET health = 1 WHERE id = $1', [hs[0].id]);
    await q("DELETE FROM construction_sites WHERE settlement_id = $1", [big.id]);
    await q("INSERT INTO construction_sites (settlement_id, kind, building_type, level, cost, work_needed, position) VALUES ($1,'building','scout_post',1,'{}',100000,1)", [big.id]);
    await q("UPDATE citizens SET role = 'forager' WHERE settlement_id = $1 AND role = 'builder'", [big.id]);
    await pass(big.id, 0.6 * DAY);
    const happy = async () => Number((await q("SELECT life->>'happiness' AS h FROM citizens WHERE id = $1", [res])).rows[0].h);
    check((await homes(big.id))[0].health === 0 && await happy() === 70 - U.HOUSE_MOOD, 'a home breaks: its family stays, a little less happy', [(await homes(big.id))[0].health, await happy()]);
    x = await big.api('POST', '/api/upkeep/repair', { house_id: hs[0].id });
    check(x.status === 200 && x.body.repair.no_builder === true, 'its repair can be queued (and the answer says nobody is a builder)');
    const two = await Promise.all([big.api('POST', '/api/upkeep/repair', { house_id: hs[1].id }), big.api('POST', '/api/upkeep/repair', { house_id: hs[1].id })]);
    check(two.filter(r => r.status === 200).length <= 1, 'two devices asking for the same repair at once: at most one');
    const rs = (await q("SELECT id FROM construction_sites WHERE settlement_id = $1 AND kind = 'repair' AND target_id = $2 AND status = 'open'", [big.id, hs[0].id])).rows[0];
    await CN.finishNow(big.id, rs.id);
    check((await homes(big.id))[0].health === 100 && await happy() === 70, 'mended: whole again, and the family is as happy as before');
    const other = await mkTown();
    x = await other.api('POST', '/api/upkeep/repair', { house_id: hs[0].id });
    check(x.status === 404, 'another town\'s home cannot be repaired');
    // Demolishing a building stops its repair.
    await q('UPDATE buildings SET health = 30 WHERE settlement_id = $1 AND type = $2', [big.id, 'market']);
    await big.api('POST', '/api/upkeep/repair', { type: 'market' });
    x = await big.api('POST', '/api/buildings/remove', { buildingId: 'market' });
    check(x.status === 200 && !(await q("SELECT 1 FROM construction_sites WHERE settlement_id = $1 AND building_type = 'market' AND status = 'open'", [big.id])).rows.length, 'demolishing a building takes its repair out of the queue');
  }

  console.log('Switching it on and off');
  {
    const s = await mkTown({ on: false });
    await q('UPDATE buildings SET health = 12 WHERE settlement_id = $1', [s.id]);
    await U.setTown(s.id, true);
    check(await health(s.id, 'tavern') === 100 && (await U.status(s.id)).on === true, 'everything starts at 100 when the switch goes on');
    await q('UPDATE buildings SET health = 0 WHERE settlement_id = $1', [s.id]);
    await U.setTown(s.id, false);
    check(await health(s.id, 'tavern') === 100, 'and nothing stays broken when it goes off');
    x = await s.api('POST', '/api/upkeep/admin/town', { on: true });
    check(x.status === 403, 'the switches are not for players');
    x = await s.api('POST', '/api/upkeep/admin/health', { health: 0 });
    check(x.status === 403 && await health(s.id, 'tavern') === 100, 'nor is setting health');
    U._resetTick();
    const due = await mkTown();
    await q("UPDATE settlements SET upkeep_at = NOW() - interval '3 hours' WHERE id = $1", [due.id]);
    await q("UPDATE settlements SET upkeep_at = NOW() WHERE upkeep_on AND id <> $1", [due.id]);
    const n = await U.tick();
    check(n >= 1 && n <= U.CONFIG.TICK_TOWNS && near(await health(due.id, 'tavern'), 100 - 100 / (5 * 24) * 3, 0.3), 'the worker does a few towns a pass, the longest-waiting first, and counts the whole time since', [n, await health(due.id, 'tavern')]);
    check(await U.tick() === 0, 'and not more often than once a minute');
    const TU = require('../lib/tuning');
    check((await TU.lifeAll()).filter(n => n.group === 'Upkeep').map(n => n.key + '=' + n.value).join() === 'UPKEEP_PER_BUILDER=8,UPKEEP_DAYS_TO_BREAK=5', '8 buildings per builder and 5 days to break, both tunable');
  }

  console.log('A broken building gives nothing from its own screen');
  {
    const t = await mkTown({ types: ['library', 'smithy', 'market', 'scout_post', 'tavern', 'fishing_post', 'watchtower', 'walls'] });
    const who = await mk(t.id, 'Ivy Scout', 'scout');
    await q('UPDATE settlements SET tile_q = tile_q WHERE id = $1', [t.id]);
    const MK = require('../lib/market'), CR = require('../lib/crafting'), RS = require('../lib/research'), WT = require('../lib/watchtower'), DF = require('../lib/defences');
    const town = async () => (await q('SELECT * FROM settlements WHERE id = $1', [t.id])).rows[0];
    const before = { market: await MK.marketLevelOf({ query: q }, t.id), library: (await RS.scholarsOf(t.id, null)).level, tower: (await WT.state(null, t.id)).level, walls: (await DF.townDefence(await town())).walls };
    check(before.market === 1 && before.library === 1 && before.tower === 1 && before.walls > 0, 'sound: each counts at its level', before);
    check((await U.needLine(null, t.id, 'library', 'Build a Library first.')) === 'Build a Library first.' && (await U.needLine(null, t.id, 'library')) === null, 'and nothing is called broken');
    let x = await t.api('POST', '/api/fishing/cast', {});
    check(x.status !== 409, 'fishing is open', x.status);
    await q('UPDATE buildings SET health = 0 WHERE settlement_id = $1', [t.id]);
    const after = { market: await MK.marketLevelOf({ query: q }, t.id), library: (await RS.scholarsOf(t.id, null)).level, tower: (await WT.state(null, t.id)).level, walls: (await DF.townDefence(await town())).walls };
    check(after.market === 0 && after.library === 0 && after.tower === 0 && after.walls === 0, 'broken: the Market, the Library, the Watchtower and the Walls count as none', after);
    check(/The Library is broken and gives nothing until a builder mends it\./.test(await U.needLine(null, t.id, 'library', 'Build a Library first.')), 'and the words say broken, not "build one"');
    x = await t.api('POST', '/api/fishing/cast', {});
    check(x.status === 409 && x.body.broken === 'fishing_post' && /Fishing Post is broken/.test(x.body.error), 'a broken Fishing Post takes no new casts', x.body);
    x = await t.api('POST', '/api/game/tavern/solo-start', { game: 'briar' });
    check(x.status === 409 && x.body.broken === 'tavern', 'a broken Tavern takes no new games', x.body);
    x = await t.api('POST', '/api/research/start', { project: 'nope' });
    const y = await t.api('POST', '/api/expeditions/send', { citizen_id: who, target_q: 1, target_r: 1 });
    check([x, y].every(r => r.status !== 500), 'the Library and the Scout Post answer, not crash', [x.status, y.status]);
    check(/Scout Post is broken/.test(y.body.error || '') || y.status === 404, 'a broken Scout Post sends nobody', y.body);
    await q("UPDATE buildings SET health = 40 WHERE settlement_id = $1", [t.id]);
    check((await MK.marketLevelOf({ query: q }, t.id)) === 1 && (await U.needLine(null, t.id, 'market')) === null && (await t.api('POST', '/api/fishing/cast', {})).status !== 409, 'worn still works');
    const other = await mkTown({ types: [] });
    check((await other.api('POST', '/api/fishing/cast', {})).status !== 409 && (await other.api('POST', '/api/game/tavern/solo-start', { game: 'briar' })).status !== 409, 'a town with no Tavern or Fishing Post is as before (they never asked for one)');
  }

  await pool.end();
}

(async () => {
  try { await main(); } catch (e) { failed++; console.error('  FAIL crashed:', e); }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
