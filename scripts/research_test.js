// scripts/research_test.js — the Library: Scholars, research points, the
// project tree and what finishing a project unlocks.
//
// Part 1 is pure (the tree). Part 2 uses the database directly (lib/research)
// and a running server over HTTP against the same DATABASE_URL. Throwaway
// databases only.
//
//   node scripts/research_test.js
//   DATABASE_URL=postgres://… CRAFTING_TEST_BASE=http://localhost:3999 CRAFTING_TEST_ADMIN_ID=990001 node scripts/research_test.js

'use strict';

const fs = require('fs');
const path = require('path');
const RS = require('../lib/research_defs');
const RD = require('../lib/resource_defs');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { passed++; console.log('  ok  ', msg); }
  else { failed++; console.error('  FAIL', msg); }
}

function part1() {
  console.log('The tree');
  check(RS.KEYS.length === 46 && RS.ERAS.length === 8, '46 projects across 8 eras');
  check(['prospecting', 'smelting', 'record_keeping', 'deep_veins', 'steelworking', 'engineering', 'volcanic_lore', 'master_recipes', 'starmetal'].every(k => RS.PROJECTS[k]),
    'every key a town may already have finished still exists');
  console.log('Layout');
  const cells = new Set(RS.KEYS.map(k => { const p = RS.PROJECTS[k]; return `${p.branch}:${p.tier}:${p.slot || 0}`; }));
  check(cells.size === RS.KEYS.length, 'no two projects share a cell (path, era, slot)');
  check(RS.KEYS.every(k => { const p = RS.PROJECTS[k]; return RS.BRANCHES[p.branch] && p.tier >= 1 && p.tier <= RS.ERAS.length && p.field === RS.BRANCHES[p.branch].field; }),
    'each project sits in a known path and era; its field comes from the path');
  check(RS.KEYS.every(k => RS.PROJECTS[k].requires.every(r => RS.PROJECTS[r].tier < RS.PROJECTS[k].tier)), 'every prerequisite sits in an earlier era (the tree reads left to right)');
  check(Object.keys(RS.BRANCHES).every(b => RS.KEYS.some(k => RS.PROJECTS[k].branch === b && RS.PROJECTS[k].tier === 1)), 'every path starts in era I');
  check(RS.PROJECTS.prospecting_2.requires.includes('prospecting') && RS.PROJECTS.prospecting_3.requires.includes('prospecting_2') && RS.pathTo('furnaces_2', []).includes('furnaces'),
    'versions need the one before (Prospecting I → II → III, Hotter Furnaces I → II)');
  check(RS.PROJECTS.starmetal.branch === 'metallurgy' && RS.PROJECTS.starmetal.requires.includes('moon_lore') && RS.PROJECTS.meteor_hunting.requires.includes('observatory'),
    'paths cross: Starmetal needs Moon Lore (Mining); Meteor Hunting needs the Observatory (Scholarship)');
  console.log('Pace');
  const chain = RS.pathTo('starmetal', []).reduce((a, k) => a + RS.PROJECTS[k].cost, 0);
  check(chain >= 25000 && chain <= 40000, `Starmetal's whole road is ${chain} points: ~3–4 months for a strong Library (~320/day)`);
  check(RS.ERA_COST.every((c, i) => i === 0 || c > RS.ERA_COST[i - 1]) && RS.KEYS.every(k => RS.PROJECTS[k].cost === RS.ERA_COST[RS.PROJECTS[k].tier - 1]), 'each era costs more than the last');
  console.log('Distance');
  const d0 = RS.distances([]);
  check(d0.prospecting === 1 && d0.shoring === 2 && d0.assaying === 3 && d0.starmetal > 2, 'nothing studied: era I is 1 step, era II is 2, beyond is hidden');
  const d1 = RS.distances(['prospecting', 'shoring']);
  check(d1.prospecting === 0 && d1.assaying === 1 && d1.deep_veins === 2 && d1.gem_lore === 3, 'studying a path reveals more of it');
  check(RS.pathTo('deep_veins', ['prospecting']).join() === 'shoring,assaying,prospecting_2,deep_veins', 'pathTo: what is still needed, in study order');
  check(RS.KEYS.every(k => RS.PROJECTS[k].requires.every(r => RS.PROJECTS[r])), 'every prerequisite exists');
  // No cycles: a topological pass finishes everything.
  const done = new Set();
  for (let i = 0; i < RS.KEYS.length; i++) for (const k of RS.KEYS) if (!done.has(k) && !RS.blockedBy(k, done)) done.add(k);
  check(done.size === RS.KEYS.length, 'the tree can be finished (no cycles)');
  check(RS.KEYS.every(k => ['nature', 'lore'].includes(RS.PROJECTS[k].field) && RS.PROJECTS[k].cost > 0), 'each project has a field and a cost');
  check(RD.DEFS.filter(d => d.research).every(d => RS.project(d.research) && (RS.project(d.research).resources || []).includes(d.key)),
    'every research-gated resource is unlocked by the project it names');
  const { BUILDINGS } = require('../buildings');
  check(Object.values(BUILDINGS).filter(b => b.research).every(b => (RS.project(b.research).buildings || []).includes(b.id)), 'research-gated buildings match their project');
  check(BUILDINGS.library && BUILDINGS.library.citizenSlots(3) === 3, 'the Library seats one Scholar per level');
  check(/Study Assaying and Prospecting II first/.test(RS.blockedBy('deep_veins', ['prospecting'])) && RS.blockedBy('deep_veins', ['prospecting', 'prospecting_2', 'assaying']) === null, 'blockedBy names what to study first');
  check(/Meteor Hunting and Moon Lore/.test(RS.blockedBy('starmetal', ['prospecting', 'deep_veins'])), '…both missing prerequisites');
  const fx = RS.effectsOf(['prospecting', 'prospecting_2', 'prospecting_3', 'furnaces', 'furnaces_2', 'scriptorium', 'academy', 'masonry', 'engineering', 'architecture']);
  check(Math.abs(fx.ore - 0.35) < 1e-9 && Math.abs(fx['craft_speed:smelter'] - 0.3) < 1e-9 && Math.abs(fx.research - 0.18) < 1e-9 && Math.abs(fx.build_cost + 0.11) < 1e-9,
    'versions stack (ore +35%, Smelter +30%, research +18%, buildings −11%)');
  const all = RS.effectsOf(RS.KEYS);
  check(all.market_fee >= -0.3 && all.build_cost >= -0.2 && all.bank === 300, 'the whole tree: fees −28%, buildings −18%, +300 bank');
  check(RS.effectsOf(new Set(['prospecting', 'engineering', 'record_keeping'])).ore === 0.1 && RS.effectsOf(['engineering']).build_cost === -0.04, 'effects add up');

  console.log('Effects on crafting');
  const crafting = require('../lib/crafting');
  const C0 = require('../lib/careers/classes');
  const tc = crafting.townCraft(new Set(['furnaces', 'swift_benches', 'guild_marks', 'apprenticeship']), 'smelter');
  check(Math.abs(tc.speed - 0.25) < 1e-9 && tc.quality === 2 && tc.xp === 0.1, 'at the Smelter: Hotter Furnaces + Swift Benches speed, Guild Marks quality, Apprenticeship XP');
  check(crafting.townCraft(new Set(['furnaces', 'swift_benches']), 'smithy').speed === 0.1, 'Hotter Furnaces only speeds the Smelter');
  const plain = crafting.benchOf(null, C0.CLASSES.smelter, null, 1), fast = crafting.benchOf(null, C0.CLASSES.smelter, null, 1, tc);
  const M0 = require('../lib/career_math');
  check(fast.quality === plain.quality + 2 && M0.craftSeconds(1200, fast.speed, 1) < M0.craftSeconds(1200, plain.speed, 1), 'the bench is faster and finer (the panel shows the same numbers)');

  console.log('Scholars');
  const C = require('../lib/careers/classes');
  const sch = C.CLASSES.scholar;
  check(sch && sch.needs[0] === 'library' && sch.primary === 'intelligence' && sch.fork.length === 2, 'Scholar: works at the Library, intelligence first, a fork');
  check(JSON.stringify(sch.tree).includes('"param":"nature"') && JSON.stringify(sch.tree).includes('"param":"lore"'), 'specialists study their own field faster');
  check(require('../lib/careers/traits').APTITUDES.bookish.classes.includes('scholar'), 'hidden talent: Bookish');

  const fe = process.env.KW_FRONTEND_DIR || path.join(__dirname, '..', '..', 'kindlewood-frontend');
  if (fs.existsSync(path.join(fe, 'js'))) check(!fs.existsSync(path.join(fe, 'js', 'research-defs.js')), 'the frontend ships no research-defs.js (distant names stay on the server)');
  check(RS.labelFor('starmetal', []) === RS.UNKNOWN_RESEARCH && RS.labelFor('prospecting', []) === 'Prospecting I', 'labelFor hides distant names');
}

async function part2() {
  const { pool } = require('../db');
  const research = require('../lib/research');
  const jwt = require('jsonwebtoken');
  const BASE = process.env.CRAFTING_TEST_BASE || process.env.CAREERS_TEST_BASE || 'http://localhost:3000';
  const SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
  const ADMIN = Number(process.env.RESEARCH_TEST_ADMIN_ID || process.env.CRAFTING_TEST_ADMIN_ID) || null;
  const RUN = Math.random().toString(36).slice(2, 7);
  const q = (t, p) => pool.query(t, p);
  let seq = 0;

  async function user(name, buildings = [], forceId = null) {
    const username = `${name}_${RUN}_${seq++}`;
    const u = forceId
      ? (await q("INSERT INTO users (id, username, email, password_hash, species) VALUES ($1,$2,$3,'x','Mice') ON CONFLICT (id) DO UPDATE SET username = users.username RETURNING id", [forceId, username, `${username}@t.l`])).rows[0]
      : (await q("INSERT INTO users (username, email, password_hash, species) VALUES ($1,$2,'x','Mice') RETURNING id", [username, `${username}@t.l`])).rows[0];
    let s = (await q('SELECT * FROM settlements WHERE user_id = $1', [u.id])).rows[0];
    if (!s) s = (await q(`INSERT INTO settlements (user_id, name, world_version, wealth, food, timber, stone, metal, last_tick) VALUES ($1,$2,2,5000,5000,5000,5000,5000,NOW()) RETURNING *`, [u.id, username])).rows[0];
    for (const [type, level] of buildings) await q('INSERT INTO buildings (settlement_id, type, level) VALUES ($1,$2,$3)', [s.id, type, level]);
    return { id: u.id, sid: s.id, token: jwt.sign({ userId: u.id, username, species: 'Mice' }, SECRET) };
  }
  async function scholar(p, name, intelligence = 8) {
    return (await q(`INSERT INTO citizens (settlement_id, name, role, stats, skills, life, life_stage, hidden_traits, visible_traits, career_settled_at)
                     VALUES ($1,$2,'scholar',$3,'{}','{"happiness":60,"hunger":20}','adult','[]','[]',NOW()) RETURNING id`,
      [p.sid, name, JSON.stringify({ strength: 8, agility: 8, endurance: 8, intelligence, charisma: 8 })])).rows[0].id;
  }
  async function api(p, method, pth, body) {
    const r = await fetch(BASE + pth, { method, headers: { Authorization: 'Bearer ' + p.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  const back = (sid, hours) => q(`UPDATE settlements SET research_settled_at = NOW() - make_interval(secs => $2) WHERE id=$1`, [sid, hours * 3600]);

  console.log('No Library');
  const none = await user('nolib');
  let r = await api(none, 'GET', '/api/research');
  check(r.status === 200 && r.body.library_level === 0 && r.body.per_hour === 0 && r.body.projects.length === 46 && r.body.branches && r.body.eras.length === 8
    && r.body.projects.every(p => p.branch && p.tier && Array.isArray(p.requires) && (p.hidden || p.unlocks)), 'GET /api/research works without a Library (whole tree, with paths and eras)');
  r = await api(none, 'POST', '/api/research/start', { project: 'prospecting' });
  check(r.status === 400 && /Library/.test(r.body.error), 'you need a Library to study');

  console.log('Studying');
  const a = await user('lib', [['library', 2]]);
  const s1 = await scholar(a, 'Quill');
  await scholar(a, 'Vellum');
  await scholar(a, 'Extra');
  r = await api(a, 'GET', '/api/research');
  check(r.body.seats === 2 && r.body.scholars.length === 2, 'a Lv2 Library seats two Scholars (the third waits)');
  const per = research.BASE_PER_HOUR * 2 * 1.1;
  check(Math.abs(r.body.per_hour - per) < 0.05, `two average Scholars at a Lv2 Library: ${per.toFixed(1)} points/hr`);
  r = await api(a, 'GET', '/api/research');
  const hid = r.body.projects.filter(p => p.hidden);
  check(hid.length > 30 && hid.every(p => p.label === '??' && !p.desc && p.cost == null && !p.unlocks && /^unknown_\d+$/.test(p.key)) && !JSON.stringify(r.body.projects).includes('starmetal'),
    `${hid.length} distant projects arrive as ?? — no names, costs or unlocks`);
  check(hid.every(p => p.requires.every(x => r.body.projects.some(y => y.key === x))), '…their arrows still connect');
  r = await api(a, 'POST', '/api/research/start', { project: 'deep_veins' });
  check(r.status === 400 && /understand/.test(r.body.error), 'a distant project can\'t be studied');
  r = await api(a, 'POST', '/api/research/queue', { project: 'deep_veins' });
  check(r.status === 400 && /understand/.test(r.body.error), '…or queued');
  r = await api(a, 'POST', '/api/research/start', { project: 'prospecting' });
  check(r.status === 200 && r.body.active === 'prospecting' && r.body.eta_hours > 0, 'start Prospecting: it is active, with an ETA');
  await back(a.sid, 10);
  await research.settle(a.sid);
  r = await api(a, 'GET', '/api/research');
  const pr = r.body.projects.find(p => p.key === 'prospecting');
  check(Math.abs(pr.progress - per * 10) < 0.5, `ten hours: ${pr.progress} points`);
  check(Math.abs(r.body.eta_hours - (120 - pr.progress) / per) < 0.2, 'the ETA counts down');
  await back(a.sid, 100);
  await research.settle(a.sid);
  r = await api(a, 'GET', '/api/research');
  check(r.body.projects.find(p => p.key === 'prospecting').status === 'done' && r.body.active === null, 'enough hours: Prospecting is done');
  check(r.body.bank > 0 && r.body.bank <= research.BANK_CAP, `leftover points bank (${r.body.bank})`);
  check(r.body.effects.ore === 0.1, 'its effect is live: +10% ore');
  const ev = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='research'", [a.sid])).rows;
  check(ev.length === 1 && /Prospecting/.test(ev[0].message), 'a settlement event says so');
  check((await research.doneSet(null, a.sid)).has('prospecting'), 'doneSet knows it');
  await back(a.sid, 200);
  await research.settle(a.sid);
  check(Number((await q('SELECT research_bank FROM settlements WHERE id=$1', [a.sid])).rows[0].research_bank) === research.BANK_CAP, 'with nothing chosen, points bank up to the cap');
  r = await api(a, 'POST', '/api/research/start', { project: 'smelting' });
  check(r.status === 200 && r.body.projects.find(p => p.key === 'smelting').progress === research.BANK_CAP && r.body.bank === 0, 'the bank goes straight into the next project');
  r = await api(a, 'POST', '/api/research/start', { project: 'prospecting' });
  check(r.status === 400 && /Already/.test(r.body.error), 'a finished project can\'t be studied again');

  console.log('No names leak');
  const doneA = await research.doneSet(null, a.sid);
  const dist = RS.distances(doneA);
  const shown = RS.KEYS.filter(k => dist[k] <= RS.HIDE_BEYOND || doneA.has(k)).map(k => RS.PROJECTS[k].label);
  const secret = RS.KEYS.filter(k => dist[k] > RS.HIDE_BEYOND && !doneA.has(k)).map(k => RS.PROJECTS[k].label)
    .filter(l => !shown.some(v => v.includes(l)));
  const leaks = [];
  for (const pth of ['/api/buildings', '/api/crafting/station/smelter', '/api/crafting/station/smithy', '/api/crafting/station/jeweller', '/api/research']) {
    const txt = JSON.stringify((await api(a, 'GET', pth)).body);
    for (const l of secret) if (txt.includes(l)) leaks.push(`${pth}: ${l}`);
  }
  check(secret.length > 20 && !leaks.length, `no distant project names in buildings, workshops or the Library (${secret.length} secret)${leaks.length ? ' — ' + leaks.join(', ') : ''}`);
  r = await api(a, 'GET', '/api/research/admin/defs');
  check(r.status === 403, 'players can\'t read the full tree');

  console.log('Fields and talent');
  const f = await user('field', [['library', 1]]);
  const phil = await scholar(f, 'Sage', 8);
  await require('../lib/careers').adminGrant(f.sid, phil, 'scholar', { level: 20 });
  await q("UPDATE citizen_classes SET spec = 'philosopher', nodes = $2 WHERE citizen_id = $1 AND class_key = 'scholar'", [phil, JSON.stringify({ 'scholar.field_notes': 3 })]);
  const nat = (await research.scholarsOf(f.sid, 'prospecting')).perHour, lore = (await research.scholarsOf(f.sid, 'record_keeping')).perHour;
  check(nat > lore && lore >= research.BASE_PER_HOUR, `a Natural Philosopher studies nature faster (${nat}/hr) than lore (${lore}/hr)`);

  console.log('Unlocks');
  const u = await user('unlock', [['library', 1], ['mine', 1], ['market', 1]]);
  await scholar(u, 'Ink');
  let b = await api(u, 'GET', '/api/buildings');
  const sm0 = (b.body.buildings || []).find(x => x.id === 'smelter');
  check(sm0 && sm0.researchMet === false && sm0.researchLabel === 'Smelting', 'the Smelter is locked behind Smelting');
  r = await api(u, 'POST', '/api/buildings/build', { buildingId: 'smelter' });
  check(r.status === 400 && /Smelting/.test(r.body.error || ''), '…and the server refuses to build it');
  const lib0 = (b.body.buildings || []).find(x => x.id === 'library');
  await research.adminComplete(u.sid, 'smelting');
  b = await api(u, 'GET', '/api/buildings');
  check((b.body.buildings || []).find(x => x.id === 'smelter').researchMet === true, 'after Smelting it can be built');
  await research.adminComplete(u.sid, 'record_keeping');
  await research.adminComplete(u.sid, 'engineering');
  b = await api(u, 'GET', '/api/buildings');
  const lib1 = (b.body.buildings || []).find(x => x.id === 'library');
  check(lib1.cost.timber === Math.ceil(lib0.cost.timber * 0.96) && lib1.discount && lib1.discount[0].label === 'Research', `Engineering: buildings cost 4% less (${lib0.cost.timber} → ${lib1.cost.timber} timber)`);
  const market = require('../lib/market');
  const mods = await market.loadModifiers({ query: q }, u.sid);
  check(Math.abs(mods.feeRate - 0.05 * 0.94) < 1e-9, 'Record Keeping: Market fees fall by 6%');
  await research.adminComplete(u.sid, 'master_recipes');
  const learned = (await q("SELECT recipe_key, source FROM settlement_recipes WHERE settlement_id=$1 AND recipe_key IN ('falchion','tower_shield')", [u.sid])).rows;
  check(learned.length === 2 && learned.every(x => x.source === 'research'), 'Master Recipes teaches the town the Falchion and the Tower Shield');
  const { oreRates } = require('../lib/ores');
  check(oreRates([], [], [{ terrain: 'mountain', level: 1 }], await research.doneSet(null, u.sid)).rates.obsidian === undefined, 'obsidian still needs Volcanic Lore');

  console.log('Effects in play');
  const per0 = (await research.scholarsOf(u.sid, 'prospecting')).perHour;
  await research.adminComplete(u.sid, 'scriptorium');
  const per1 = (await research.scholarsOf(u.sid, 'prospecting')).perHour;
  check(Math.abs(per1 - per0 * 1.08) < 0.06, `Scriptorium: research 8% faster (${per0} → ${per1}/hr)`);
  const carry0 = (await market.loadModifiers({ query: q }, u.sid)).carryWeight;
  await research.adminComplete(u.sid, 'caravan_routes');
  const carry1 = (await market.loadModifiers({ query: q }, u.sid)).carryWeight;
  check(carry1 > carry0, `Caravan Routes: porters carry more (${carry0} → ${carry1})`);

  console.log('Queue');
  const qt = await user('queue', [['library', 1]]);
  await scholar(qt, 'Leaf');
  await api(qt, 'GET', '/api/research');
  r = await api(qt, 'POST', '/api/research/queue', { project: 'shoring' });
  check(r.status === 200 && r.body.active === 'prospecting' && r.body.queue.join() === 'shoring', 'queueing Shoring adds Prospecting I first — and with nothing studied, it starts');
  r = await api(qt, 'POST', '/api/research/queue', { project: 'masonry' });
  r = await api(qt, 'POST', '/api/research/queue', { project: 'surveying' });
  check(r.body.queue.join() === 'shoring,masonry,surveying' && r.body.projects.find(p => p.key === 'surveying').queued === 3, 'later projects go to the end; each knows its place');
  r = await api(qt, 'POST', '/api/research/queue', { project: 'masonry' });
  check(r.status === 409, 'already planned');
  r = await api(qt, 'DELETE', '/api/research/queue/masonry');
  check(r.status === 200 && r.body.queue.join() === 'shoring', 'removing Masonry also drops Surveying, which needed it');
  r = await api(qt, 'POST', '/api/research/start', { project: 'scriptorium' });
  check(r.body.active === 'scriptorium' && r.body.queue.join() === 'prospecting,shoring', 'Study now: the old project goes back to the front of the queue');
  r = await api(qt, 'DELETE', '/api/research/queue/scriptorium');
  check(r.body.active === 'prospecting' && r.body.queue.join() === 'shoring', 'stopping the active project starts the next');
  await back(qt.sid, 400);
  await research.settle(qt.sid);
  r = await api(qt, 'GET', '/api/research');
  const doneNow = r.body.projects.filter(p => p.status === 'done').map(p => p.key);
  check(doneNow.includes('prospecting') && doneNow.includes('shoring') && r.body.active === null && r.body.queue.length === 0, 'a long absence finishes the queue in order');
  const evs = (await q("SELECT message FROM settlement_events WHERE settlement_id=$1 AND type='research' ORDER BY id", [qt.sid])).rows;
  check(evs.length === 2 && /Prospecting I/.test(evs[0].message) && /Shoring/.test(evs[1].message), '…with an event for each');
  check(r.body.bank > 0, 'and the leftover banks');
  for (const k of ['masonry', 'scriptorium', 'record_keeping', 'apprenticeship', 'smelting']) await api(qt, 'POST', '/api/research/queue', { project: k });
  r = await api(qt, 'POST', '/api/research/queue', { project: 'grand_works' });
  check(r.status === 400, 'too distant, or too many, is refused');
  await research.adminComplete(qt.sid, 'quills');
  r = await api(qt, 'GET', '/api/research');
  check(r.body.bank_cap === research.BANK_CAP + 100, 'Quills & Ink: more points can bank');

  console.log('Through the settlement tick');
  const t = await user('tick', [['library', 1]]);
  await scholar(t, 'Nib');
  await api(t, 'GET', '/api/research');
  await api(t, 'POST', '/api/research/start', { project: 'record_keeping' });
  await back(t.sid, 5);
  await api(t, 'GET', '/api/game/settlement');
  const prog = Number((await q("SELECT progress FROM settlement_research WHERE settlement_id=$1 AND project='record_keeping'", [t.sid])).rows[0].progress);
  check(prog >= research.BASE_PER_HOUR * 5 - 0.5, `loading the settlement credits study time (${prog} points)`);

  if (ADMIN) {
    console.log('Dev Tools');
    const adm = await user('rsadm', [], ADMIN);
    r = await api(adm, 'POST', '/api/research/admin/complete', { project: 'starmetal' });
    check(r.status === 200 && r.body.projects.find(p => p.key === 'starmetal').status === 'done', 'Dev Tools: finish a project now');
    r = await api(adm, 'POST', '/api/research/admin/reset', {});
    check(r.status === 200 && r.body.projects.every(p => p.status !== 'done'), 'Dev Tools: reset research');
    r = await api(a, 'POST', '/api/research/admin/reset', {});
    check(r.status === 403, 'players can\'t use the Dev Tools routes');
    r = await api(adm, 'GET', '/api/research/admin/defs');
    check(r.status === 200 && r.body.projects.length === 46 && r.body.projects.some(p => p.label === RS.PROJECTS.starmetal.label), 'Dev Tools: the full tree, names and all');
    const tile = (await q('SELECT q, r, terrain FROM tiles ORDER BY q, r LIMIT 1')).rows[0];
    if (tile) {
      r = await api(a, 'POST', '/api/map/tile-terrain', { q: tile.q, r: tile.r, terrain: 'mountain' });
      check(r.status === 403, 'players can\'t repaint terrain');
      r = await api(adm, 'POST', '/api/map/tile-terrain', { q: tile.q, r: tile.r, terrain: tile.terrain });
      check(r.status === 200 && r.body.tile.terrain === tile.terrain, 'admins still can');
    }
  } else console.log('  (admin checks skipped — set CRAFTING_TEST_ADMIN_ID)');

  void s1;
  await pool.end();
}

(async () => {
  part1();
  if (process.env.DATABASE_URL) {
    try { await part2(); } catch (e) { failed++; console.error('  FAIL part 2 crashed:', e); }
  } else console.log('\n(Part 2 skipped — set DATABASE_URL and CRAFTING_TEST_BASE)');
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
